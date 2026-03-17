import { Box, Text } from '@mantine/core';

type MessageRole = 'user' | 'assistant' | 'error';

interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  isLoading?: boolean;
}

interface ChatMessageBubbleProps {
  message: ChatMessage;
}

export default function ChatMessageBubble({ message }: ChatMessageBubbleProps) {
  const isUser = message.role === 'user';
  const isError = message.role === 'error';

  return (
    <Box
      style={{
        display: 'flex',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
        marginBottom: '12px',
      }}
    >
      <Box
        style={{
          maxWidth: '80%',
          padding: '10px 14px',
          borderRadius: isUser ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
          backgroundColor: isError
            ? '#fef2f2'
            : isUser
            ? '#06b6d4'
            : '#f0f9ff',
          color: isUser ? '#fff' : isError ? '#dc2626' : '#0f172a',
          border: isError ? '1px solid #fecaca' : 'none',
        }}
      >
        {message.isLoading ? (
          <Text size="sm" c="dimmed" fs="italic">
            正在思考...
          </Text>
        ) : (
          <Text size="sm" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {message.content}
          </Text>
        )}
      </Box>
    </Box>
  );
}
