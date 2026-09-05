import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Terms of Service' };

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-300">
      <header className="border-b border-slate-800 px-6 py-4">
        <Link href="/" className="text-sm text-blue-400 hover:text-blue-300">← SmartRoute AI</Link>
      </header>
      <article className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="text-3xl font-bold text-white">Terms of Service</h1>
        <p className="mt-1 text-sm text-slate-500">Last updated: June 2026</p>

        <section className="mt-8 space-y-4 text-sm leading-relaxed">
          <h2 className="text-lg font-semibold text-white">Acceptance</h2>
          <p>
            By accessing SmartRoute AI, you agree to these Terms. If you do not agree, do not use the service.
          </p>

          <h2 className="text-lg font-semibold text-white">Service description</h2>
          <p>
            SmartRoute AI provides an API gateway for routing requests to third-party LLM providers,
            with cost optimization, caching, and reliability features. We do not guarantee uninterrupted
            availability of upstream providers.
          </p>

          <h2 className="text-lg font-semibold text-white">Acceptable use</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>Do not use the service for illegal activities or to generate harmful content</li>
            <li>Do not attempt to bypass rate limits, budgets, or security controls</li>
            <li>Do not resell API access without authorization</li>
            <li>Comply with upstream provider terms of service</li>
          </ul>

          <h2 className="text-lg font-semibold text-white">Billing & plans</h2>
          <p>
            Paid plans are billed according to the plan selected. Usage beyond plan limits may be
            restricted. Refunds are handled on a case-by-case basis.
          </p>

          <h2 className="text-lg font-semibold text-white">Limitation of liability</h2>
          <p>
            SmartRoute AI is provided &quot;as is&quot;. We are not liable for indirect damages, data loss,
            or costs arising from provider outages or model output quality.
          </p>

          <h2 className="text-lg font-semibold text-white">Contact</h2>
          <p>
            Questions about these terms:{' '}
            <a href="mailto:legal@smartroute.dev" className="text-blue-400">legal@smartroute.dev</a>
          </p>
        </section>
      </article>
    </div>
  );
}
