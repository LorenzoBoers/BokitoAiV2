/**
 * Messages hub controller entry.
 *
 * Customer/channel threads use the Communication page shell; agent direct chat
 * uses DirectCommunication with the same list chrome and a swappable detail pane
 * (AgentChatView). Prefer importing this module when adding hub routes so the
 * product noun stays Messages while Signal remains the API entity.
 */
export { default as MessagesHub } from './Communication'
export { default as MessagesDirectHub } from './DirectCommunication'
