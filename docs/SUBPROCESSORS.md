# Subprocessor List

**SmartRoute AI**

*Last updated: June 2025*

This list identifies third-party Sub-processors that may process Personal Data on behalf of SmartRoute AI customers when using the hosted or self-configured Service.

When self-hosting, you control which Sub-processors are active via environment configuration.

---

## Infrastructure Sub-processors

| Sub-processor | Purpose | Data processed | Location |
|---------------|---------|----------------|----------|
| **Your cloud provider** (AWS, GCP, Azure, etc.) | Compute, networking | All service data | Per your deployment region |
| **PostgreSQL host** | Primary database | Account, request logs, cache embeddings | Per your deployment region |
| **Redis host** | Job queues, rate limits, cache metadata | Session tokens, queue payloads | Per your deployment region |

*Self-hosted deployments: you are the infrastructure provider. No SmartRoute-operated cloud is required.*

---

## Communication Sub-processors

| Sub-processor | Purpose | Data processed | Location |
|---------------|---------|----------------|----------|
| **Your SMTP provider** (SendGrid, SES, Postmark, etc.) | Transactional email | Email address, name, reset/invite links | Per SMTP provider |

Configured via `SMTP_*` environment variables. Disabled if not configured.

---

## Payment Sub-processors (optional)

| Sub-processor | Purpose | Data processed | Location |
|---------------|---------|----------------|----------|
| **Stripe, Inc.** | Subscription billing | Email, billing name, payment method (tokenized) | US / EU (Stripe data residency) |

Active only when `STRIPE_SECRET_KEY` is configured.

---

## Authentication Sub-processors (optional)

| Sub-processor | Purpose | Data processed | Location |
|---------------|---------|----------------|----------|
| **Google LLC** | OAuth sign-in | Email, name, avatar URL | US / global |

Active only when `GOOGLE_CLIENT_ID` is configured.

---

## LLM Provider Sub-processors

When you route requests through SmartRoute AI, prompt content and metadata are transmitted to the LLM providers you configure. These are **Controller-selected** Sub-processors:

| Provider | Purpose | Data processed | Privacy policy |
|----------|---------|----------------|----------------|
| **OpenAI, L.L.C.** | LLM inference | Prompts, responses, usage metadata | https://openai.com/policies/privacy-policy |
| **Anthropic, PBC** | LLM inference | Prompts, responses, usage metadata | https://www.anthropic.com/privacy |
| **Google LLC** (Gemini) | LLM inference | Prompts, responses, usage metadata | https://policies.google.com/privacy |
| **Cohere Inc.** | LLM inference | Prompts, responses, usage metadata | https://cohere.com/privacy |
| **Mistral AI** | LLM inference | Prompts, responses, usage metadata | https://mistral.ai/terms/ |
| **Ollama** (self-hosted) | Local LLM inference | Prompts, responses | N/A — runs on your infrastructure |

Restrict providers per workspace via **Settings → Allowed providers**.

---

## Observability Sub-processors (optional)

| Sub-processor | Purpose | Data processed | Location |
|---------------|---------|----------------|----------|
| **Grafana Labs** (self-hosted) | Metrics dashboards | Aggregated metrics, no prompt content by default | Your infrastructure |

Prometheus metrics exposed at `/metrics` do not include prompt text.

---

## Changes to this list

Material additions or replacements of Sub-processors will be announced with 30 days' notice via email to workspace owners and an update to this document.

---

## Contact

Sub-processor questions: **privacy@smartroute.dev**

*Customize this list for your deployment before sharing with customers or attaching to enterprise agreements.*
