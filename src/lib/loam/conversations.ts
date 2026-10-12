/**
 * Loam's conversation persistence.
 *
 * WHY THIS IS NOT IN src/lib/copilot/conversations.ts
 *   It was, and that was a boundary leak. `copilot/conversations.ts` imports
 *   `answer` from `copilot/engine.ts` at module level, so every Loam turn
 *   pulled the legacy keyword router into its module graph. Nothing called it
 *   -- `runTurn`, the only consumer, is unused -- but "Loam must never reach
 *   the legacy engine" is a claim worth being able to make without an
 *   asterisk, and a transitive import is exactly how such a claim rots.
 *
 *   The cost is two small functions duplicated (`createConversation`,
 *   `loadMessages`). That is the cheaper half of the trade: a boundary a test
 *   can enforce, against eight lines of SQL written twice.
 *
 * SCHEMA
 *   The existing `copilot_conversations` / `copilot_messages` tables, unchanged
 *   and unmigrated. Their RLS already scopes both to `user_id = auth.uid()`,
 *   and the column meanings line up with what Loam stores.
 */
import { supabase } from '@/lib/supabase'
import type { CopilotMessage } from '@/lib/copilot/types'

/** Start a thread. `language` is free text on the table, so ig/yo are fine. */
export async function createConversation(userId: string, language: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('copilot_conversations')
    .insert({ user_id: userId, language })
    .select('id')
    .single()
  if (error || !data) return null
  return (data as { id: string }).id
}

/** Every message in a thread, oldest first. RLS proves ownership. */
export async function loadMessages(conversationId: string): Promise<CopilotMessage[]> {
  const { data } = await supabase
    .from('copilot_messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
  return (data as CopilotMessage[]) ?? []
}

/**
 * The member's most recent thread, so returning to Loam shows the conversation
 * rather than an empty panel.
 */
export async function latestConversation(userId: string): Promise<string | null> {
  const { data } = await supabase
    .from('copilot_conversations')
    .select('id')
    .eq('user_id', userId)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as { id: string } | null)?.id ?? null
}

/**
 * Persist one Loam exchange.
 *
 * Maps onto the existing columns with nothing added: `content` is the guarded
 * answer, `data_sources` the evidence behind it, `data_as_of` the newest
 * observation date, `was_answered` false when Loam declined.
 *
 * KNOWN LIMIT: the model's separated reasoning has no column and is not
 * persisted, so a reloaded thread shows the grounded answer without it.
 * Writing it into `data_sources` would overload a column that means something
 * else, and giving it a column is a migration.
 */
export async function appendLoamExchange(
  conversationId: string,
  userText: string,
  answerText: string,
  opts: {
    sources: { source: string; level: number }[]
    asOf: string | null
    answered: boolean
  },
): Promise<void> {
  await supabase.from('copilot_messages').insert({
    conversation_id: conversationId, role: 'user', content: userText,
  })
  await supabase.from('copilot_messages').insert({
    conversation_id: conversationId,
    role: 'assistant',
    content: answerText,
    data_sources: opts.sources,
    data_as_of: opts.asOf,
    was_answered: opts.answered,
  })
}
