import { tokenizeMentions } from '../../lib/mentions'

/** Highlighter layer for composer mention pills. Pair with ComposerCard. */
export function MentionHighlight({ raw, interim }: { raw: string; interim?: string }) {
  const pending = interim?.trim() ?? ''
  return (
    <>
      {tokenizeMentions(raw).map((token, index) =>
        token.kind === 'text' ? (
          <span key={index}>{token.text}</span>
        ) : (
          <span key={index} className="composer-mention-pill" data-mention-type={token.targetType}>
            @{token.name}
          </span>
        ),
      )}
      {pending ? (
        <span className="text-text-muted">{raw.trim() ? ` ${pending}` : pending}</span>
      ) : null}
      {'\n'}
    </>
  )
}
