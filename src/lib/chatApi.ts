import { API_BASE, apiFetch } from './apiClient';

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

const CHAT_API_URL = `${API_BASE}/api/chat`;

export async function sendChatMessage(request: ChatRequest): Promise<ChatResponse> {
  return apiFetch<ChatResponse>(CHAT_API_URL, {
    method: 'POST',
    body: JSON.stringify(request),
  });
}
