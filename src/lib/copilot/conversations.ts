import { supabase } from '@/lib/supabase'
import { answer, type AssistantResult } from '@/lib/copilot/engine'
import type { CopilotLanguage, CopilotMessage } from '@/lib/copilot/types'

/**
 * Conversation persistence. RLS guarantees a user only ever touches their own
 * threads (ownership proven through the parent conversation). Assistant messages
 * store the provenance (data_sources + data_as_of) so every answer is traceable.
 */

export async function createConversation(userId: string, language: CopilotLanguage): Promise<string | null> {
  const { data, error } = await supabase
    .from('copilot_conversations')
    .insert({ user_id: userId, language })
    .select('id')
    .single()
  if (error || !data) return null
  return (data as { id: string }).id
}

export async function loadMessages(conversationId: string): Promise<CopilotMessage[]> {
  const { data } = await supabase
    .from('copilot_messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
  return (data as CopilotMessage[]) ?? []
}

async function appendUserMessage(conversationId: string, content: string): Promise<void> {
  await supabase.from('copilot_messages').insert({ conversation_id: conversationId, role: 'user', content })
}

async function appendAssistantMessage(conversationId: string, result: AssistantResult): Promise<void> {
  await supabase.from('copilot_messages').insert({
    conversation_id: conversationId,
    role: 'assistant',
    content: result.content,
    data_sources: result.dataSources,
    data_as_of: result.dataAsOf,
    was_answered: result.wasAnswered,
  })
}

export async function logFlaggedQuestion(userId: string, question: string, language: CopilotLanguage): Promise<void> {
  await supabase.from('copilot_flagged_questions').insert({ question, language, user_id: userId })
}

/**
 * Run one full turn: persist the user message, compute the data-only answer,
 * persist the assistant message with its provenance, and — when the question
 * could not be answered from data — log it to the improvement loop.
 */
export async function runTurn(params: {
  conversationId: string
  userId: string
  text: string
  appLanguage: CopilotLanguage
}): Promise<AssistantResult> {
  const { conversationId, userId, text, appLanguage } = params
  await appendUserMessage(conversationId, text)
  const result = await answer(text, appLanguage)
  await appendAssistantMessage(conversationId, result)
  if (!result.wasAnswered) {
    await logFlaggedQuestion(userId, text, result.language)
  }
  return result
}
