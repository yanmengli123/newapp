import { useState, useCallback } from 'react';
import { sendChatMessage } from '../../lib/chatApi';
import ChatLauncher from './ChatLauncher';
import ChatWindow from './ChatWindow';

type MessageRole = 'user' | 'assistant' | 'error';

interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  data?: unknown;
  isLoading?: boolean;
}

export default function ChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const toggleOpen = () => setIsOpen((prev) => !prev);

  const handleSend = useCallback(async () => {
    const userMessage = inputValue.trim();
    if (!userMessage || isLoading) return;

    // 添加用户消息
    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: userMessage,
    };

    // 添加 AI 消息占位（加载中）
    const aiMsg: ChatMessage = {
      id: `ai-${Date.now()}`,
      role: 'assistant',
      content: '',
      isLoading: true,
    };

    setMessages((prev) => [...prev, userMsg, aiMsg]);
    setInputValue('');
    setIsLoading(true);

    try {
      const response = await sendChatMessage({ message: userMessage });

      // 构建显示内容：如果有 data 字段则格式化显示
      let displayContent = response.reply || '无回复';
      if (response.data) {
        const dataStr = typeof response.data === 'object'
          ? JSON.stringify(response.data, null, 2)
          : String(response.data);
        displayContent = `${response.reply}\n\n${dataStr}`;
      }

      // 更新 AI 消息
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === aiMsg.id
            ? {
                ...msg,
                content: displayContent,
                data: response.data,
                isLoading: false,
              }
            : msg
        )
      );
    } catch (error) {
      // 显示错误消息
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === aiMsg.id
            ? {
                ...msg,
                role: 'error',
                content: error instanceof Error ? error.message : '请求失败，请稍后重试',
                isLoading: false,
              }
            : msg
        )
      );
    } finally {
      setIsLoading(false);
    }
  }, [inputValue, isLoading]);

  return (
    <>
      <ChatLauncher isOpen={isOpen} onClick={toggleOpen} />
      {isOpen && (
        <ChatWindow
          messages={messages}
          inputValue={inputValue}
          onInputChange={setInputValue}
          onSend={handleSend}
          onClose={toggleOpen}
          isLoading={isLoading}
        />
      )}
    </>
  );
}
