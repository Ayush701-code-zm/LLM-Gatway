import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Subprocessors' };

export default function SubprocessorsPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-300">
      <header className="border-b border-slate-800 px-6 py-4">
        <Link href="/" className="text-sm text-blue-400 hover:text-blue-300">← SmartRoute AI</Link>
      </header>
      <article className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="text-3xl font-bold text-white">Subprocessor List</h1>
        <p className="mt-2 text-sm text-slate-500">Last updated: June 2025</p>

        <section className="mt-8 space-y-6 text-sm leading-relaxed">
          <div>
            <h2 className="text-lg font-semibold text-white">LLM providers (Controller-selected)</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-400">
              <li>OpenAI, Anthropic, Google Gemini, Cohere, Mistral</li>
              <li>Ollama (self-hosted, optional)</li>
            </ul>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">Infrastructure</h2>
            <p className="text-slate-400">
              Your PostgreSQL, Redis, and compute provider — data stays in your deployment region when self-hosted.
            </p>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">Optional services</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-400">
              <li>SMTP provider (transactional email)</li>
              <li>Stripe (billing, when configured)</li>
              <li>Google OAuth (sign-in, when configured)</li>
            </ul>
          </div>
          <p className="text-slate-500">
            Full list: <code className="text-slate-400">docs/SUBPROCESSORS.md</code> in the repository.
          </p>
          <p>
            Related:{' '}
            <Link href="/privacy" className="text-blue-400 hover:text-blue-300">Privacy Policy</Link>
            {' · '}
            <Link href="/dpa" className="text-blue-400 hover:text-blue-300">DPA</Link>
          </p>
        </section>
      </article>
    </div>
  );
}
