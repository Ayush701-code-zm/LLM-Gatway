# Data Processing Agreement (DPA)

**SmartRoute AI — Standard Data Processing Addendum**

*Last updated: June 2025*

This Data Processing Agreement ("DPA") forms part of the agreement between the customer ("Controller") and SmartRoute AI ("Processor") for use of the SmartRoute AI gateway platform.

---

## 1. Definitions

- **Personal Data**: Any information relating to an identified or identifiable natural person processed through the Service.
- **Processing**: Any operation performed on Personal Data, including collection, storage, transmission, and deletion.
- **Sub-processors**: Third parties engaged by Processor to process Personal Data (see [SUBPROCESSORS.md](./SUBPROCESSORS.md)).
- **Service**: The SmartRoute AI API gateway, dashboard, and related infrastructure.

---

## 2. Scope & Roles

The Controller determines the purposes and means of processing Personal Data submitted via API requests, team invitations, and account registration.

The Processor processes Personal Data solely to provide the Service as described in the Terms of Service and this DPA.

---

## 3. Processing Instructions

Processor shall process Personal Data only:

1. On documented instructions from Controller (including API configuration, workspace settings, and dashboard actions);
2. As required by applicable law (with prior notice to Controller where legally permitted).

Processor shall not use Personal Data for advertising, profiling, or any purpose unrelated to the Service.

---

## 4. Categories of Data & Data Subjects

| Category | Examples | Data Subjects |
|----------|----------|---------------|
| Account data | Name, email, hashed password | Workspace admins, members |
| Request content | Prompts, system prompts, LLM responses | End users of Controller's applications |
| Usage metadata | Token counts, latency, cost, IP address | End users; API key operators |
| Billing data | Stripe customer ID, plan tier | Billing contacts |

Controller is responsible for ensuring a lawful basis exists for submitting Personal Data to the Service.

---

## 5. Security Measures

Processor implements appropriate technical and organizational measures including:

- Encryption in transit (TLS 1.2+)
- Password hashing (bcrypt, cost factor 12)
- API key storage (SHA-256 hashes only; plaintext shown once at creation)
- Role-based workspace access control
- Audit logging for administrative actions
- Rate limiting and budget guards
- Semantic cache isolation per workspace

A detailed security overview is available in [DEPLOYMENT.md](./DEPLOYMENT.md).

---

## 6. Sub-processors

Controller authorizes Processor to engage Sub-processors listed in [SUBPROCESSORS.md](./SUBPROCESSORS.md). Processor will notify Controller of material changes with 30 days' notice.

Controller may object to a new Sub-processor on reasonable grounds relating to data protection.

---

## 7. International Transfers

Where Personal Data is transferred outside the Controller's jurisdiction, Processor ensures appropriate safeguards (Standard Contractual Clauses or equivalent mechanisms) are in place with Sub-processors.

---

## 8. Data Retention & Deletion

- Request logs are retained per workspace configuration (default: until manually deleted or account termination).
- Upon termination, Processor deletes or returns Personal Data within 30 days, except where retention is required by law.
- Controller may export request history via the dashboard CSV export or API.

---

## 9. Data Subject Rights

Processor assists Controller in responding to data subject requests (access, rectification, erasure, restriction, portability) within reasonable timeframes, to the extent Processor processes relevant Personal Data.

Requests should be routed through Controller as the primary contact point for data subjects.

---

## 10. Security Incidents

Processor notifies Controller without undue delay (within 72 hours where feasible) upon becoming aware of a Personal Data breach affecting Controller data, including nature of breach, categories affected, and remediation steps.

---

## 11. Audits

Upon reasonable written request, Processor provides information necessary to demonstrate compliance with this DPA. On-site audits may be conducted no more than once per year with 30 days' notice, subject to confidentiality obligations.

---

## 12. Liability

Liability under this DPA is subject to the limitations set forth in the Terms of Service.

---

## 13. Contact

For DPA inquiries: **privacy@smartroute.dev**

*This document is a template for self-hosted deployments. Customize entity names, contacts, and jurisdiction before customer use.*
