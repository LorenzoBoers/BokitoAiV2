---
title: Hand work to a coding tool
intro: Connect Cursor, Claude Managed Agents or Devin and hand coding work from a conversation.
description: Connect your own coding-tool API keys under Settings → Developers, approve a Decision, and follow the job in the same thread until the pull request lands.
keywords: workbench, cursor, claude, devin, coding, pull request, dispatch_work, developers
sort: 55
related: mcp-endpoint,api-overview,decisions
---

# Hand work to a coding tool

Hand coding work from a conversation to Cursor, Claude Managed Agents or Devin. Bokito starts the job after you approve a Decision, shows progress in the thread, and brings the pull request back.

Connect your own provider key under Settings → Developers. Bokito never runs the coding tool on its own servers in this release.

## Connect Cursor Cloud Agents

![Connect Cursor on the Developers page](/api/docs/assets/mcp-endpoint/connect-ai-tools.png)

*Hand work to a coding tool on Settings → Developers.*

1. Open **Settings → Developers**.
2. Scroll to **Hand work to a coding tool**.
3. Expand **Cursor Cloud Agents**.
4. Paste your Cursor API key from the Cursor dashboard, then choose **Connect**.
5. When an agent proposes `dispatch_work`, approve the Decision in Communication.

## Connect Claude Managed Agents

1. Open **Settings → Developers → Hand work to a coding tool**.
2. Expand **Claude Managed Agents**.
3. Paste your Anthropic API key. Optionally add a GitHub token so the sandbox can clone and open pull requests.
4. Choose **Connect**.
5. Approve the Decision when an agent hands work to Claude.

## Connect Devin

1. Open **Settings → Developers → Hand work to a coding tool**.
2. Expand **Devin**.
3. Paste your Devin service-user API key (`cog_…`) and organization id.
4. Choose **Connect**.
5. Approve the Decision when an agent starts a Devin session.

## Follow a job in the conversation

1. Open the conversation where the job started.
2. Read the status updates while the tool works. On an active job, use **Follow up** to send more instructions or **Stop** to cancel.
3. If the tool asks a question, answer the Decision card; Bokito sends your answer as a follow-up.
4. When a pull request appears, open it from the status line on the project canvas (**Workbench jobs** tile and **Resources**) or in the thread.

You can also open **Connections** and choose **Set up** on the **AI (coding) tools** banner to land on the same Developers section.
