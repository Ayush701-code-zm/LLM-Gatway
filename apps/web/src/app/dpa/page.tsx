import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Data Processing Agreement' };

export default function DpaPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-300">
      <header className="border-b border-slate-800 px-6 py-4">
        <Link href="/" className="text-sm text-blue-400 hover:text-blue-300">← SmartRoute AI</Link>
      </header>
      <article className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="text-3xl font-bold text-white">Data Processing Agreement</h1>
        <p className="mt-2 text-sm text-slate-500">Last updated: June 2025</p>

        <section className="mt-8 space-y-4 text-sm leading-relaxed">
          <p>
            This DPA forms part of the agreement between the customer (Controller) and SmartRoute AI
            (Processor) for use of the gateway platform.
          </p>
          <h2 className="text-lg font-semibold text-white">Processing scope</h2>
          <p>
            Processor handles account data, API request content, usage metadata, and billing data solely
            to provide the Service — not for advertising or unrelated purposes.
          </p>
          <h2 className="text-lg font-semibold text-white">Security</h2>
          <p>
            TLS in transit, bcrypt password hashing, hashed API keys, workspace RBAC, audit logging, and
            rate limiting are implemented by default.
          </p>
          <h2 className="text-lg font-semibold text-white">Sub-processors</h2>
          <p>
            See the{' '}
            <Link href="/subprocessors" className="text-blue-400 hover:text-blue-300">Subprocessor List</Link>{' '}
            for LLM providers, infrastructure, and optional services (Stripe, Google OAuth, SMTP).
          </p>
          <p className="text-slate-500">
            Full template: <code className="text-slate-400">docs/DPA.md</code> in the repository.
          </p>
        </section>
      </article>
    </div>
  );
}
