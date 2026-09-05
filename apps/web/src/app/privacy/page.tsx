import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Privacy Policy' };

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-300">
      <header className="border-b border-slate-800 px-6 py-4">
        <Link href="/" className="text-sm text-blue-400 hover:text-blue-300">← SmartRoute AI</Link>
      </header>
      <article className="mx-auto max-w-3xl px-6 py-12 prose prose-invert prose-slate">
        <h1 className="text-3xl font-bold text-white">Privacy Policy</h1>
        <p className="text-sm text-slate-500">Last updated: June 2026</p>

        <section className="mt-8 space-y-4 text-sm leading-relaxed">
          <h2 className="text-lg font-semibold text-white">Overview</h2>
          <p>
            SmartRoute AI (&quot;we&quot;, &quot;our&quot;) operates an AI gateway platform. This policy describes
            how we collect, use, and protect information when you use our service.
          </p>

          <h2 className="text-lg font-semibold text-white">Data we collect</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>Account information (name, email, workspace details)</li>
            <li>API request metadata (prompts, model selections, token counts, costs)</li>
            <li>Usage analytics for routing, caching, and billing</li>
            <li>Technical logs (IP addresses, request IDs, error traces)</li>
          </ul>

          <h2 className="text-lg font-semibold text-white">How we use data</h2>
          <p>
            We use collected data to provide the gateway service, enforce budgets and rate limits,
            improve routing decisions, send alerts, and maintain security. Prompt content may be
            stored for request logging and semantic caching as configured by your workspace.
          </p>

          <h2 className="text-lg font-semibold text-white">Third-party providers</h2>
          <p>
            When you use SmartRoute, your requests are forwarded to LLM providers (OpenAI, Anthropic,
            Google, etc.) according to your configuration. Their privacy policies apply to data
            processed by those providers. See our{' '}
            <Link href="/subprocessors" className="text-blue-400 hover:text-blue-300">Subprocessor List</Link>.
          </p>

          <h2 className="text-lg font-semibold text-white">Enterprise compliance</h2>
          <p>
            For B2B customers, our{' '}
            <Link href="/dpa" className="text-blue-400 hover:text-blue-300">Data Processing Agreement</Link>{' '}
            describes how we process personal data on your behalf.
          </p>

          <h2 className="text-lg font-semibold text-white">Contact</h2>
          <p>
            For privacy inquiries, contact your workspace administrator or{' '}
            <a href="mailto:privacy@smartroute.dev" className="text-blue-400">privacy@smartroute.dev</a>.
          </p>
        </section>
      </article>
    </div>
  );
}
