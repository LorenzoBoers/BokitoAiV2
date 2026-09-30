"""Accounting module: invoices and payments as conversations (Moneybird first).

Customers write about invoices; the module gives agents typed recognition
(`invoice_question`, `payment_reminder`), a playbook per type and tools that
look up and act in the ledger. Sending an invoice or reminder is consequential
and always asks an operator.
"""

from __future__ import annotations

from bokito.modules import DocSeed, ModuleSpec, PlaybookSeed, SignalTypeSeed, register_module

SLUG = "accounting"

SPEC = register_module(
    ModuleSpec(
        slug=SLUG,
        name="Accounting (Moneybird)",
        description=(
            "Invoice and payment conversations with Moneybird as the ledger: look up "
            "invoices for the contact, answer payment questions, send reminders after approval."
        ),
        version="1.0.0",
        connection_provider="moneybird",
        signal_types=(
            SignalTypeSeed(
                slug="invoice_question",
                name="Invoice question",
                description="A customer asks about an invoice: amount, due date, a copy, VAT.",
                color="#2563eb",
                fields=[
                    {"key": "invoice_id", "label": "Invoice", "type": "string"},
                    {"key": "amount", "label": "Amount", "type": "number"},
                ],
                recognition={
                    "keywords": ["invoice", "factuur", "betaling", "payment", "btw", "vat"],
                    "instructions": "Recognise when the customer refers to an invoice or payment.",
                },
                autonomy_cap="assisted",
                playbook_slug="answer_invoice_question",
            ),
            SignalTypeSeed(
                slug="payment_reminder",
                name="Payment reminder",
                description="An invoice is overdue and the customer has to be reminded.",
                color="#d97706",
                fields=[
                    {"key": "invoice_id", "label": "Invoice", "type": "string"},
                    {"key": "days_overdue", "label": "Days overdue", "type": "number"},
                ],
                autonomy_cap="assisted",
                playbook_slug="send_payment_reminder",
            ),
        ),
        playbooks=(
            PlaybookSeed(
                slug="answer_invoice_question",
                name="Answer an invoice question",
                description="Find the invoice in Moneybird, explain status and amount, "
                "offer a copy.",
                steps=[
                    {"tool": "moneybird_find_contact", "note": "Match on the sender's email."},
                    {"tool": "moneybird_list_invoices", "note": "Open and recent invoices."},
                    {
                        "tool": "reply",
                        "note": "Answer with invoice number, amount, due date and status. "
                        "Offer a copy when asked; never share another contact's invoices.",
                    },
                ],
            ),
            PlaybookSeed(
                slug="send_payment_reminder",
                name="Send a payment reminder",
                description="Confirm the invoice is still open, then send the reminder on approval",
                steps=[
                    {"tool": "moneybird_list_invoices", "note": "Only state open or late."},
                    {
                        "tool": "moneybird_send_invoice",
                        "note": "Reminder by email; asks an operator.",
                    },
                    {"tool": "add_note", "note": "Log what was sent and when."},
                ],
                autonomy_cap="assisted",
            ),
        ),
        docs=(
            DocSeed(
                path="skills/accounting",
                title="Accounting: how to handle invoice conversations",
                body=(
                    "# Accounting\n\n"
                    "- Match the contact in Moneybird by email before quoting any amount.\n"
                    "- Quote invoice number, total including VAT, due date and state.\n"
                    "- A reminder is only sent for invoices in state open or late, never paid.\n"
                    "- Sending anything from the ledger asks an operator first.\n"
                    "- Do not share invoices of another contact or organization.\n"
                ),
            ),
        ),
        tools=("moneybird_find_contact", "moneybird_list_invoices", "moneybird_send_invoice"),
        settings_schema={
            "reminder_days": {
                "type": "integer",
                "default": 7,
                "label": "Days after due date before a reminder",
            }
        },
    )
)

from bokito.modules.accounting import tools  # noqa: E402,F401  (registers the tools)
