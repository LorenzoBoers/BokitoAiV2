/**
 * Messages hub controller entry.
 *
 * Customer, channel, and company-agent chats share the Communication page shell
 * (close / assign / snooze / queues). Prefer importing this module when adding
 * hub routes so the product noun stays Messages while Signal remains the API entity.
 */
export { default as MessagesHub } from './Communication'
