import { apiFetch } from './apiClient';

// Types - inline to avoid import issues
interface ChatRequest {
  message: string;
  history?: Array<{ role: string; content: string }>;
}

interface ChatResponse {
  reply: string;
  type?: string;
  data?: unknown;
}

export async function sendChatMessage(request: ChatRequest): Promise<ChatResponse> {
  return apiFetch<ChatResponse>('/api/chat', {
    method: 'POST',
    body: JSON.stringify(request),
  });
}
