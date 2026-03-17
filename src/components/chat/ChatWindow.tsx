import { useRef, useEffect } from 'react';
import {
  Box,
  Group,
  Text,
  TextInput,
  ActionIcon,
  Paper,
  ScrollArea,
  rem,
} from '@mantine/core';
import { IconSend, IconX } from '@tabler/icons-react';
import ChatMessageBubble from './ChatMessageBubble';

type MessageRole = 'user' | 'assistant' | 'error';

interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  isLoading?: boolean;
}

interface ChatWindowProps {
  messages: ChatMessage[];
  inputValue: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onClose: () => void;
  isLoading: boolean;
}

const WELCOME_MESSAGE: ChatMessage = {
  id: 'welcome',
  role: 'assistant',
  content:
    '您好！我是 GRCg6a 生信智能助手。当前可以处理以下请求：\n• 基因组统计（基因组大小、GC含量、N50等）\n• GFF注释统计（基因数量、mRNA、CDS等）\n• 序列提取\n\n请告诉我您想了解什么？',
};

export default function ChatWindow({
  messages,
  inputValue,
  onInputChange,
  onSend,
  onClose,
  isLoading,
}: ChatWindowProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 自动滚动到最新消息
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  const displayMessages = messages.length === 0 ? [WELCOME_MESSAGE] : messages;

  return (
    <Paper
      shadow="lg"
      radius="xl"
      withBorder
      style={{
        position: 'fixed',
        bottom: '100px',
        right: '24px',
        width: '380px',
        height: '560px',
        maxWidth: 'calc(100vw - 48px)',
        maxHeight: 'calc(100vh - 120px)',
        zIndex: 1000,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: '#fff',
        borderColor: '#e2e8f0',
      }}
    >
      {/* 标题栏 */}
      <Box
        p="md"
        style={{
          borderBottom: '1px solid #e2e8f0',
          backgroundColor: '#f8fafc',
        }}
      >
        <Group justify="space-between" align="center">
          <Group gap="sm">
            <Text fw={700} size="md" c="cyan.7">
              BioViz AI 助手
            </Text>
          </Group>
          <ActionIcon
            variant="subtle"
            color="gray"
            onClick={onClose}
            size="sm"
          >
            <IconX size={rem(16)} />
          </ActionIcon>
        </Group>
      </Box>

      {/* 消息列表 */}
      <ScrollArea
        style={{ flex: 1 }}
        viewportRef={scrollRef}
        p="md"
      >
        {displayMessages.map((msg) => (
          <ChatMessageBubble key={msg.id} message={msg} />
        ))}
        <div ref={messagesEndRef} />
      </ScrollArea>

      {/* 输入区域 */}
      <Box
        p="md"
        style={{
          borderTop: '1px solid #e2e8f0',
          backgroundColor: '#f8fafc',
        }}
      >
        <Group gap="sm" align="flex-end">
          <TextInput
            placeholder="输入您的问题..."
            value={inputValue}
            onChange={(e) => onInputChange(e.currentTarget.value)}
            onKeyDown={handleKeyDown}
            disabled={isLoading}
            style={{ flex: 1 }}
            styles={{
              input: {
                borderRadius: '12px',
                '&:focus': {
                  borderColor: '#06b6d4',
                },
              },
            }}
          />
          <ActionIcon
            size="lg"
            radius="xl"
            color="cyan"
            variant="filled"
            onClick={onSend}
            disabled={!inputValue.trim() || isLoading}
          >
            <IconSend size={rem(18)} />
          </ActionIcon>
        </Group>
      </Box>
    </Paper>
  );
}
