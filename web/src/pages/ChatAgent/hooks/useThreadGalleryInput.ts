import { useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router';

interface UseThreadGalleryInputResult {
  message: string;
  setMessage: React.Dispatch<React.SetStateAction<string>>;
  isLoading: boolean;
  handleSend: () => Promise<void>;
  handleKeyPress: (e: KeyboardEvent) => void;
}

export function useThreadGalleryInput(workspaceId: string): UseThreadGalleryInputResult {
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();

  const handleSend = async () => {
    if (!message.trim() || isLoading || !workspaceId) {
      return;
    }

    setIsLoading(true);
    try {
      navigate(`/chat/t/__default__`, {
        state: {
          workspaceId,
          initialMessage: message.trim(),
        },
      });

      setMessage('');
    } catch (error) {
      console.error('Error navigating to thread:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return {
    message,
    setMessage,
    isLoading,
    handleSend,
    handleKeyPress,
  };
}
