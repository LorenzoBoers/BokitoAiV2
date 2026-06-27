import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import {
  addNote,
  badgeCounts,
  createConversation,
  deleteConversation,
  deleteThread,
  getThread,
  listChatMessages,
  listChatTargets,
  listConversations,
  listThreads,
  markThreadRead,
  markThreadUnread,
  patchThread,
  pinThread,
  releaseThread,
  renameConversation,
  replyToThread,
  resolveThreadDecision,
  takeoverThread,
  unpinThread,
  type Attachment,
  type PatchThreadInput,
  type ReplyAction,
  type ResolveAction,
  type ThreadFilters,
} from '../lib/api'
import { onGatewayEvent } from '../lib/gateway'

export const messagingKeys = {
  all: ['messaging'] as const,
  threads: (filters: ThreadFilters) => ['threads', filters] as const,
  thread: (id: string) => ['thread', id] as const,
  badgeCounts: ['badgeCounts'] as const,
  conversations: ['conversations'] as const,
  chatMessages: (id: string) => ['chatMessages', id] as const,
  chatTargets: ['chatTargets'] as const,
}

export function useGatewayInvalidation() {
  const queryClient = useQueryClient()

  useEffect(() => {
    let debounce: ReturnType<typeof setTimeout> | null = null
    const invalidateThreads = () => {
      if (debounce) return
      debounce = setTimeout(() => {
        debounce = null
        void queryClient.invalidateQueries({ queryKey: ['threads'] })
        void queryClient.invalidateQueries({ queryKey: messagingKeys.badgeCounts })
        void queryClient.invalidateQueries({ queryKey: messagingKeys.conversations })
      }, 600)
    }

    const unsubThreads = onGatewayEvent('threads', invalidateThreads)
    return () => {
      unsubThreads()
      if (debounce) clearTimeout(debounce)
    }
  }, [queryClient])
}

export function useBadgeCounts() {
  return useQuery({
    queryKey: messagingKeys.badgeCounts,
    queryFn: badgeCounts,
    staleTime: 15_000,
  })
}

export function useThreadsInfinite(filters: Omit<ThreadFilters, 'page'>) {
  return useInfiniteQuery({
    queryKey: messagingKeys.threads(filters),
    queryFn: ({ pageParam }) => listThreads({ ...filters, page: pageParam }),
    initialPageParam: 1,
    getNextPageParam: (last) => last.nextPage ?? undefined,
  })
}

export function useThreadDetail(threadId: string | null) {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: messagingKeys.thread(threadId ?? ''),
    queryFn: () => getThread(threadId!),
    enabled: !!threadId,
  })

  useEffect(() => {
    if (!threadId) return
    const unsub = onGatewayEvent(`signal:${threadId}`, () => {
      void queryClient.invalidateQueries({ queryKey: messagingKeys.thread(threadId) })
    })
    return unsub
  }, [threadId, queryClient])

  useEffect(() => {
    if (!threadId || !query.data?.thread.has_unread) return
    void markThreadRead(threadId).then(() => {
      void queryClient.invalidateQueries({ queryKey: ['threads'] })
      void queryClient.invalidateQueries({ queryKey: messagingKeys.badgeCounts })
    })
  }, [threadId, query.data?.thread.has_unread, queryClient])

  return query
}

export function useConversations() {
  return useQuery({
    queryKey: messagingKeys.conversations,
    queryFn: listConversations,
  })
}

export function useChatMessages(conversationId: string | null) {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: messagingKeys.chatMessages(conversationId ?? ''),
    queryFn: () => listChatMessages(conversationId!),
    enabled: !!conversationId,
  })

  useEffect(() => {
    if (!conversationId) return
    const unsub = onGatewayEvent(`signal:${conversationId}`, () => {
      void queryClient.invalidateQueries({ queryKey: messagingKeys.chatMessages(conversationId) })
    })
    return unsub
  }, [conversationId, queryClient])

  return query
}

export function useChatTargets() {
  return useQuery({
    queryKey: messagingKeys.chatTargets,
    queryFn: listChatTargets,
    staleTime: 60_000,
  })
}

export function useThreadMutations(threadId: string) {
  const queryClient = useQueryClient()

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: messagingKeys.thread(threadId) })
    void queryClient.invalidateQueries({ queryKey: ['threads'] })
    void queryClient.invalidateQueries({ queryKey: messagingKeys.badgeCounts })
  }

  const patch = useMutation({
    mutationFn: (input: PatchThreadInput) => patchThread(threadId, input),
    onSuccess: invalidate,
  })

  const reply = useMutation({
    mutationFn: ({
      bodyText,
      action,
      attachments,
    }: {
      bodyText: string
      action?: ReplyAction
      attachments?: Attachment[]
    }) => replyToThread(threadId, bodyText, action ?? 'send', attachments),
    onSuccess: invalidate,
  })

  const note = useMutation({
    mutationFn: ({ bodyText, attachments }: { bodyText: string; attachments?: Attachment[] }) =>
      addNote(threadId, bodyText, attachments),
    onSuccess: invalidate,
  })

  const resolveDecision = useMutation({
    mutationFn: ({ messageId, action }: { messageId: string; action: ResolveAction }) =>
      resolveThreadDecision(threadId, messageId, action),
    onSuccess: invalidate,
  })

  const pin = useMutation({
    mutationFn: (pinned: boolean) => (pinned ? pinThread(threadId) : unpinThread(threadId)),
    onSuccess: invalidate,
  })

  const takeover = useMutation({
    mutationFn: (paused: boolean) => (paused ? takeoverThread(threadId) : releaseThread(threadId)),
    onSuccess: invalidate,
  })

  const markUnread = useMutation({
    mutationFn: () => markThreadUnread(threadId),
    onSuccess: invalidate,
  })

  const remove = useMutation({
    mutationFn: () => deleteThread(threadId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['threads'] })
      void queryClient.invalidateQueries({ queryKey: messagingKeys.badgeCounts })
    },
  })

  return { patch, reply, note, resolveDecision, pin, takeover, markUnread, remove }
}

export function useConversationMutations() {
  const queryClient = useQueryClient()

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: messagingKeys.conversations })
  }

  const create = useMutation({
    mutationFn: ({ title, agentId }: { title?: string; agentId?: string }) =>
      createConversation(title, agentId),
    onSuccess: invalidate,
  })

  const rename = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => renameConversation(id, title),
    onSuccess: invalidate,
  })

  const remove = useMutation({
    mutationFn: (id: string) => deleteConversation(id),
    onSuccess: invalidate,
  })

  return { create, rename, remove }
}
