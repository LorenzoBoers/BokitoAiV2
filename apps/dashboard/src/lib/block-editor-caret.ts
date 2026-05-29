/** Caret helpers for contentEditable block fields. */

export function getCaretOffset(element: HTMLElement): number {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return 0
  const range = selection.getRangeAt(0)
  const preRange = range.cloneRange()
  preRange.selectNodeContents(element)
  preRange.setEnd(range.endContainer, range.endOffset)
  return preRange.toString().length
}

export function setCaretOffset(element: HTMLElement, offset: number): void {
  const selection = window.getSelection()
  if (!selection) return

  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  let remaining = offset
  let node = walker.nextNode() as Text | null

  while (node) {
    const len = node.textContent?.length ?? 0
    if (remaining <= len) {
      const range = document.createRange()
      range.setStart(node, remaining)
      range.collapse(true)
      selection.removeAllRanges()
      selection.addRange(range)
      return
    }
    remaining -= len
    node = walker.nextNode() as Text | null
  }

  const range = document.createRange()
  range.selectNodeContents(element)
  range.collapse(false)
  selection.removeAllRanges()
  selection.addRange(range)
}

export function placeCaretAtEnd(element: HTMLElement): void {
  setCaretOffset(element, element.innerText.length)
}

export function isCaretAtStart(element: HTMLElement): boolean {
  return getCaretOffset(element) === 0
}
