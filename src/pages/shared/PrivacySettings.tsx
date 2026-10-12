import { Link } from 'react-router-dom'
import { ExternalLink, Eye, FileText, Mail, ShieldCheck, Trash2 } from 'lucide-react'
import { OPERATOR, POLICY_EFFECTIVE_DATE, POLICY_VERSION } from '@/content/legal/privacy-policy'
import { PrivacyPreferences } from '@/components/PrivacyPreferences'
import { DashboardCard } from '@/components/DashboardCard'
import { Card } from '@/components/ui/card'

/**
 * Settings → Privacy.
 *
 * Three things a member should be able to do without emailing anyone: see
 * what the current policy is, see and change what they have agreed to, and
 * find out how to ask for their data or its deletion.
 *
 * Profile visibility is NOT duplicated here. It already lives on the Settings
 * screen next to the handle it governs, and a second control writing the same
 * column is how two switches start disagreeing. This links there instead.
 */
export default function PrivacySettings() {
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-lg font-semibold text-emerald-950">
          <ShieldCheck className="h-5 w-5 text-emerald-700" strokeWidth={1.5} aria-hidden />
          Privacy
        </h1>
        <p className="mt-0.5 text-sm text-emerald-900/60">
          What Loamy does with your information, and what you have chosen.
        </p>
      </div>

      <DashboardCard title="Your preferences">
        <PrivacyPreferences />
      </DashboardCard>

      <DashboardCard title="The policy">
        <div className="space-y-3">
          <p className="text-sm text-emerald-900/70">
            You are covered by version {POLICY_VERSION}, last updated {POLICY_EFFECTIVE_DATE}. If we
            make a material change we will show you the notice again rather than change what we do
            quietly.
          </p>
          <Link
            to="/privacy"
            className="inline-flex items-center gap-1.5 rounded text-sm font-semibold text-emerald-700 hover:text-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
          >
            <FileText className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Read the Privacy Policy
          </Link>
        </div>
      </DashboardCard>

      <DashboardCard title="Who can see you">
        <div className="space-y-2">
          <p className="text-sm text-emerald-900/70">
            Your public profile visibility - public, members only, or private - is set beside your
            Loamy handle on the Settings screen.
          </p>
          <Link
            to="../settings"
            relative="path"
            className="inline-flex items-center gap-1.5 rounded text-sm font-semibold text-emerald-700 hover:text-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
          >
            <Eye className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Go to profile visibility
          </Link>
        </div>
      </DashboardCard>

      <DashboardCard title="Your data">
        <div className="space-y-3 text-sm text-emerald-900/70">
          <p>
            You can ask for a copy of what we hold about you, ask us to correct it, or ask us to
            close your account and delete your personal information. Email us from the address on
            your account and we will answer within 30 days.
          </p>
          <p className="flex items-start gap-2 border-l-2 border-emerald-700 bg-emerald-50/60 px-3 py-2 text-[13px] leading-relaxed text-emerald-900/80">
            <Trash2 className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.5} aria-hidden />
            <span>
              Some records survive deletion, and we would rather say so than promise otherwise:
              completed transactions, batch traceability history and verification decisions are
              kept, because another party relied on them. Everything else goes.
            </span>
          </p>
          <a
            href={`mailto:${OPERATOR.supportEmail}?subject=Privacy%20request`}
            className="inline-flex items-center gap-1.5 rounded font-semibold text-emerald-700 hover:text-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
          >
            <Mail className="h-4 w-4" strokeWidth={1.5} aria-hidden /> {OPERATOR.supportEmail}
          </a>
        </div>
      </DashboardCard>

      <Card className="p-4">
        <p className="text-[12px] leading-relaxed text-emerald-900/55">
          Loamy stores no BVN and no NIN. Where a bank needs to verify your identity, you give that
          information to the bank through the bank&rsquo;s own process - Loamy records only that the
          bank told us verification succeeded.
        </p>
        <a
          href={OPERATOR.website}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-flex items-center gap-1 rounded text-[12px] font-medium text-emerald-700 hover:text-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
        >
          {OPERATOR.company} <ExternalLink className="h-3 w-3" aria-hidden />
        </a>
      </Card>
    </div>
  )
}
