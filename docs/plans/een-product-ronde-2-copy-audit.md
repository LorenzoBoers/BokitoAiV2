# Copy audit, ronde 1 glossary rewrite

Compared working tree values with `HEAD` (`git diff -w`). Good replacements stay: screen names Today/Vandaag, Folders/Mappen, Connections/Koppelingen, For you and Voor jou as labels, Flow, New conversation/Nieuw gesprek, and Logboek as the Govern tab.

| Area | Changed values | Bad |
|---|---|---|
| Dashboard EN locales | 423 | 15 |
| Dashboard NL locales | 427 | 88 |
| Mobile EN | 11 plus 2 key renames | 8 |
| Mobile NL | 6 | 2 |
| Product-help EN | ~197 | ~35 |
| Product-help NL | ~192 | ~40 |

## Bad classes (every instance is restored in ronde 2)

1. Login verbs became Logboek: `Logboek in`, `Logboek uit`, `Logboek opnieuw`, `Logboek eerst` in `nl/nav.json`, `nl/calendar.json`, `nl/communication.json`, `nl/profile.json`, `nl/workspaces.json`, mobile `login.subtitle`, and `nl/integrations/integrations.md`.
2. Mobile keys `home.autonomie` and `thread.vandaag` (restore `home.autonomy`, `thread.today`). EN table held Dutch values (`Vandaag`, `Autonomie:`, `Nieuw gesprek`, `autonomie stats`).
3. `needs you` / `needs attention` became `For you` mid-sentence in EN locales and docs (`an today`, `Could not load today.`, `Act on what For you`).
4. Doubled or half-translated NL: `Foldermappen`, `Today-onderdelen`, `Folder-ID`, `Catalog-apps`, `Folderagent`, `folderqueue`, `Folderdocs`, `folderplafond`.
5. Article: `de Aanbod` (aanbod is het-woord). Gender: `dit/het/dat map`.
6. Broken sentences: `Begrenst Autonomie zodat`, `Staat Autonomie toe tot Autonoom`, `volgt de Autonomie`.
7. Doc links `/docs/connections/` (no such folder) and frontmatter `related: autonomie`.
8. Leftover English in NL: `Workspace-configuratie`, `boards en docs`, `Teammates`, `workspace-docs`.

Good examples that stay: `tabs.overview` Today/Vandaag, `tabs.folders` Folders/Mappen, `inboxAi` Autonomie, Govern tab Logboek.
