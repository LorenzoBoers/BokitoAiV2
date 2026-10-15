/**
 * Chat-mode bubble splitting. Canonical implementation lives in
 * `@bokito/shared` (shared with the chat widget). Mirror of
 * `split_chat_messages` in `apps/api/app/services/agent/reply_mode.py`.
 */

export {
  MAX_CHAT_MESSAGES,
  MIN_MESSAGE_CHARS,
  isCustomerChannel,
  splitChatMessages,
} from '@bokito/shared'
