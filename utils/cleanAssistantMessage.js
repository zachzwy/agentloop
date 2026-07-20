/**
 * Strip DeepSeek-specific extension fields (e.g. `reasoning_content`) from an
 * assistant message before storing it in the conversation history.  The API
 * returns these fields on every response but they aren't part of the standard
 * OpenAI schema, so echoing them back is pure waste.
 */
export function cleanAssistantMessage(msg) {
  if (msg.role !== "assistant") return msg;
  const { reasoning_content, ...cleaned } = msg;
  return cleaned;
}
