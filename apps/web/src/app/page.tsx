import Link from 'next/link';
import { Zap, TrendingDown, Shield, Activity, ArrowRight } from 'lucide-react';

const FEATURES = [
  {
    icon: TrendingDown,
    title: '30–60% cost savings',
    description: 'Smart routing sends simple prompts to cheap models and complex ones to capable models.',
  },
  {
    icon: Zap,
    title: 'Semantic cache',
    description: 'pgvector similarity search returns cached responses — no duplicate LLM charges.',
  },
  {
    icon: Shield,
    title: 'Automatic failover',
    description: 'Circuit breakers, retries, and fallback routing keep your app running when providers fail.',
  },
  {
    icon: Activity,
    title: 'Full observability',
    description: 'Every request traced with cost, latency, cache hits, and provider health.',
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Nav */}
      <header className="border-b border-slate-800/80">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600">
              <Zap className="h-4 w-4 text-white" />
            </div>
            <span className="text-lg font-bold">SmartRoute AI</span>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/login" className="text-sm text-slate-400 hover:text-white">
              Sign in
            </Link>
            <Link
              href="/register"
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium hover:bg-blue-500"
            >
              Get started free
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-6 py-24 text-center">
        <p className="mb-4 text-sm font-semibold uppercase tracking-widest text-blue-400">
          AI Gateway & Cost Optimization
        </p>
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
          One API.
          <br />
          <span className="text-slate-400">Every LLM provider.</span>
          <br />
          Maximum savings.
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-400">
          SmartRoute sits between your app and OpenAI, Anthropic, Google, Cohere, Mistral, and Ollama —
          routing intelligently, caching semantically, and failing over automatically.
        </p>
        <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <Link
            href="/register"
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-3 text-sm font-semibold shadow-lg shadow-blue-600/25 hover:bg-blue-500"
          >
            Start for free
            <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            href="/login"
            className="rounded-lg border border-slate-700 px-6 py-3 text-sm font-medium text-slate-300 hover:border-slate-600 hover:text-white"
          >
            Sign in to dashboard
          </Link>
        </div>
        <p className="mt-4 text-xs text-slate-600">Free plan · 500 req/day · No credit card</p>
      </section>

      {/* Features */}
      <section className="border-t border-slate-800/80 bg-slate-900/30 py-20">
        <div className="mx-auto grid max-w-6xl gap-8 px-6 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map(({ icon: Icon, title, description }) => (
            <div key={title} className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
              <div className="mb-4 inline-flex rounded-lg bg-blue-900/40 p-2.5">
                <Icon className="h-5 w-5 text-blue-400" />
              </div>
              <h3 className="font-semibold text-white">{title}</h3>
              <p className="mt-2 text-sm text-slate-400">{description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-800 py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 sm:flex-row">
          <p className="text-xs text-slate-600">© {new Date().getFullYear()} SmartRoute AI</p>
          <div className="flex gap-6 text-xs text-slate-500">
            <Link href="/privacy" className="hover:text-slate-300">Privacy Policy</Link>
            <Link href="/terms" className="hover:text-slate-300">Terms of Service</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
