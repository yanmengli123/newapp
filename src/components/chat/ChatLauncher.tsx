import { ActionIcon, Box, rem } from '@mantine/core';
import { IconMessage, IconX } from '@tabler/icons-react';

interface ChatLauncherProps {
  isOpen: boolean;
  onClick: () => void;
}

export default function ChatLauncher({ isOpen, onClick }: ChatLauncherProps) {
  return (
    <Box
      style={{
        position: 'fixed',
        bottom: '24px',
        right: '24px',
        zIndex: 1000,
      }}
    >
      <ActionIcon
        size={56}
        radius="xl"
        variant="filled"
        color="cyan"
        onClick={onClick}
        style={{
          boxShadow: '0 4px 12px rgba(6, 182, 212, 0.4)',
          transition: 'transform 0.2s ease, box-shadow 0.2s ease',
        }}
        styles={{
          root: {
            '&:hover': {
              transform: 'scale(1.05)',
              boxShadow: '0 6px 16px rgba(6, 182, 212, 0.5)',
            },
          },
        }}
      >
        {isOpen ? (
          <IconX size={rem(24)} stroke={1.5} />
        ) : (
          <IconMessage size={rem(24)} stroke={1.5} />
        )}
      </ActionIcon>
    </Box>
  );
}
