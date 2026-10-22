/** Ambient types so mail-quote tests can construct a document without @types/jsdom. */
declare module 'jsdom' {
  export class JSDOM {
    constructor(html?: string)
    readonly window: { document: Document }
  }
}
