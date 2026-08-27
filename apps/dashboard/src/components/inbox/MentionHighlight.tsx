import { tokenizeMentions } from '../../lib/mentions'

/** Highlighter layer for composer mention pills. Pair with ComposerCard. */
export function MentionHighlight({ raw }: { raw: string }) {
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
      {'\n'}
    </>
  )
}
