import { useEffect, useState } from 'react'
import { Mail, MessageCircle, ShieldCheck } from 'lucide-react'
import {
  OPERATOR, POLICY_EFFECTIVE_DATE, POLICY_VERSION, PRIVACY_POLICY,
  type PolicySection,
} from '@/content/legal/privacy-policy'
import { PublicShell } from '@/pages/public/PublicShell'
import { PrivacyPreferences } from '@/components/PrivacyPreferences'
import { Card } from '@/components/ui/card'

/**
 * The Privacy Policy, at /privacy. Public — no authentication, by design:
 * someone deciding whether to sign up has to be able to read it first.
 *
 * Everything here is rendered from src/content/legal/privacy-policy.ts as
 * TEXT. No dangerouslySetInnerHTML, no markdown parser, no HTML in the
 * content module — so a policy edit cannot become an injection, whoever makes
 * it. The formatting comes from the structure (parts, sections, bullets),
 * not from markup inside the strings.
 */
export default function Privacy() {
  const [active, setActive] = useState<string>('')

  // Highlight the contents entry for whatever is on screen. Purely an
  // affordance: every link works without it, and it degrades to nothing.
  useEffect(() => {
    const ids = PRIVACY_POLICY.flatMap((p) => p.sections.map((s) => s.id))
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting)
        if (visible.length > 0) setActive(visible[0].target.id)
      },
      { rootMargin: '-80px 0px -70% 0px' },
    )
    for (const id of ids) {
      const el = document.getElementById(id)
      if (el) observer.observe(el)
    }
    return () => observer.disconnect()
  }, [])

  return (
    <PublicShell>
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
        <header className="max-w-3xl">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-700">
            <ShieldCheck className="h-4 w-4" aria-hidden /> Legal
          </p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-emerald-950 sm:text-3xl">
            Privacy Policy
          </h1>
          <p className="mt-2 text-sm text-emerald-900/60">
            Version {POLICY_VERSION} · Last updated{' '}
            <time dateTime={POLICY_EFFECTIVE_DATE}>{formatDate(POLICY_EFFECTIVE_DATE)}</time>
          </p>
          <p className="mt-4 text-[15px] leading-relaxed text-emerald-900/75">
            This policy describes what {OPERATOR.product} actually does with information. We have
            kept out the processing we do not carry out, rather than including it to be safe.
          </p>
        </header>

        <div className="mt-8 gap-10 lg:grid lg:grid-cols-[220px_1fr]">
          {/* Contents. Hidden on small screens, where a long sticky list of
              links costs more than it gives. */}
          <nav className="hidden lg:block" aria-label="Policy contents">
            <div className="sticky top-24 space-y-4">
              {PRIVACY_POLICY.map((part) => (
                <div key={part.id}>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-900/40">
                    {part.title}
                  </p>
                  <ul className="mt-1.5 space-y-1">
                    {part.sections.map((s) => (
                      <li key={s.id}>
                        <a
                          href={`#${s.id}`}
                          className={`block rounded px-1.5 py-0.5 text-[12px] leading-snug transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${
                            active === s.id
                              ? 'bg-emerald-50 font-medium text-emerald-800'
                              : 'text-emerald-900/55 hover:text-emerald-800'
                          }`}
                          aria-current={active === s.id ? 'true' : undefined}
                        >
                          {s.heading}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </nav>

          <div className="min-w-0 space-y-10">
            {PRIVACY_POLICY.map((part) => (
              <section key={part.id} aria-labelledby={`part-${part.id}`}>
                <h2
                  id={`part-${part.id}`}
                  className="border-b border-line pb-2 text-lg font-bold tracking-tight text-emerald-950"
                >
                  {part.title}
                </h2>
                <div className="mt-5 space-y-7">
                  {part.sections.map((s) => (
                    <Section key={s.id} section={s} />
                  ))}
                </div>
              </section>
            ))}

            {/* The controls, on the page they belong to: someone who has just
                read what is optional can change it without hunting. */}
            <section aria-labelledby="preferences-heading" className="scroll-mt-24" id="preferences">
              <h2
                id="preferences-heading"
                className="border-b border-line pb-2 text-lg font-bold tracking-tight text-emerald-950"
              >
                Your privacy preferences
              </h2>
              <div className="mt-5">
                <PrivacyPreferences />
              </div>
            </section>

            <Card className="p-5">
              <h2 className="text-sm font-semibold text-emerald-950">Questions about your privacy</h2>
              <p className="mt-1 text-[13px] leading-relaxed text-emerald-900/65">
                Email us from the address on your account and we will answer.
              </p>
              <div className="mt-3 flex flex-col gap-2 text-[13px] sm:flex-row sm:gap-5">
                <a
                  href={`mailto:${OPERATOR.supportEmail}`}
                  className="flex items-center gap-1.5 rounded font-medium text-emerald-800 hover:text-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                >
                  <Mail className="h-4 w-4" strokeWidth={1.5} aria-hidden /> {OPERATOR.supportEmail}
                </a>
                <a
                  href={OPERATOR.whatsappUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 rounded font-medium text-emerald-800 hover:text-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                >
                  <MessageCircle className="h-4 w-4" strokeWidth={1.5} aria-hidden /> {OPERATOR.whatsapp}
                </a>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </PublicShell>
  )
}

function Section({ section }: { section: PolicySection }) {
  return (
    <div id={section.id} className="scroll-mt-24">
      <h3 className="text-[15px] font-semibold text-emerald-950">{section.heading}</h3>
      {section.body?.map((p, i) => (
        <p key={i} className="mt-2 text-[14px] leading-relaxed text-emerald-900/75">
          {p}
        </p>
      ))}
      {section.bullets && section.bullets.length > 0 && (
        <ul className="mt-3 space-y-2">
          {section.bullets.map((b, i) => (
            <li key={i} className="flex gap-2.5 text-[14px] leading-relaxed text-emerald-900/75">
              <span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-emerald-700" aria-hidden />
              <span>
                {b.term && <span className="font-semibold text-emerald-950">{b.term} - </span>}
                {b.text}
              </span>
            </li>
          ))}
        </ul>
      )}
      {section.callout && (
        <p className="mt-3 border-l-2 border-emerald-700 bg-emerald-50/60 px-3 py-2 text-[13px] leading-relaxed text-emerald-900/80">
          {section.callout}
        </p>
      )}
    </div>
  )
}

function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  return d.toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
}
