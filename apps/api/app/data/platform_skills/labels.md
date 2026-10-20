---
name: Labels
name_nl: Labels
description: How agents propose, create and attach labels so they stay few, reusable and in the right place.
description_nl: Hoe agents labels voorstellen, aanmaken en koppelen zodat het er weinig blijven, herbruikbaar en op de juiste plek.
tools: create_tag, update_tag, merge_labels, set_thread_tags, record_thread_read, set_contact_tags, propose_label_plan
---
## Skill: labels
A label groups many conversations by one reusable idea. Few labels that are used often beat many labels that are used once.

Rules:
1. One label is one dimension: a topic or a kind of work (`facturen`, `support`, `offertes`). Never join two ideas in one name (`mistral_facturen`, `klant_vraag_levering`).
2. Who sent it is not a conversation label. A supplier, client or partner belongs on the company or contact; every conversation from them shows that label.
3. Reuse first. Call list_tags and pick an existing label when it roughly fits (`administratie` covers invoices and receipts unless the workspace splits them). Create a new one only when nothing fits and the idea will come back.
4. No item labels: no numbers, dates, months, invoice ids or one-off subjects. Do not propose a separate label per document type of the same flow (invoice vs payment receipt) unless the operator works them apart.
5. Recurring mail from the same sender or domain gets an inbox rule with action tag, so the next one is labelled without you. Do not label each item by hand when a rule covers it.
6. One to three labels per conversation. Skip a label when it adds nothing to filtering.
7. Every new label needs a description that says when to apply it; autonomous labelling reads that line.

Proposing labels: send one label plan with propose_label_plan. Each line is a label (existing or new) with its scope: conversation, company, contact or rule. The operator approves it once. Do not create the proposed labels or promise them before that.

Labelling on your own: attach only existing labels from the catalog with set_thread_tags or record_thread_read. When nothing fits, report unknown_signal; never invent a label in an autonomous turn.

Renaming: call update_tag with the current name and new_name. The name changes everywhere that label is used, because it is one label, not a copy on each conversation. Pass a description when the meaning changed. Renaming a flow label also renames its flow. If new_name is an existing free label, the two merge; call merge_labels when combining is what you mean.

Merging labels: when two labels are the same idea (`factuur` and `facturen`), call merge_labels. `name` is the spare label, `into` is the one to keep. Every conversation, contact, company, folder and inbox rule moves onto the kept label, and the spare name is removed. Do not merge a flow label; that name is the flow's title. Do not delete_tag the spare label: delete drops it from everything instead of moving the items.

If a tool returns near_duplicate, combines_labels or item_specific, use the label it names in `use`. When that label already exists and a spare one means the same thing, merge_labels instead of creating another.
