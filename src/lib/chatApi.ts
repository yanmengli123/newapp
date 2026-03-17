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

// ===== 配置区域 =====
// 替换为你的实际 API 地址
const CHAT_API_URL = 'http://localhost:8000/api/chat';
// 如果需要 token 认证，替换为你的 token（可选）
const API_TOKEN = 'YOUR_TOKEN';
// =====================

export async function sendChatMessage(request: ChatRequest): Promise<ChatResponse> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  // 如果有 token，添加到请求头
  if (API_TOKEN && API_TOKEN !== 'YOUR_TOKEN') {
    headers['Authorization'] = `Bearer ${API_TOKEN}`;
  }

  const response = await fetch(CHAT_API_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error(`API 请求失败: ${response.status} ${response.statusText}`);
  }

  return response.json();
}
