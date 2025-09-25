import { useState, useEffect } from 'react';

export function useNetworkStatus() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [connectionType, setConnectionType] = useState('unknown');

  useEffect(() => {
    const updateOnlineStatus = () => {
      setIsOnline(navigator.onLine);
    };

    const updateConnectionType = () => {
      // Check if we have network connection info
      if ('connection' in navigator) {
        setConnectionType(navigator.connection.effectiveType || 'unknown');
      } else if ('mozConnection' in navigator) {
        setConnectionType(navigator.mozConnection.type || 'unknown');
      } else if ('webkitConnection' in navigator) {
        setConnectionType(navigator.webkitConnection.type || 'unknown');
      }
    };

    // Initial check
    updateOnlineStatus();
    updateConnectionType();

    // Listen for network changes
    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);

    // Listen for connection changes
    if ('connection' in navigator) {
      navigator.connection.addEventListener('change', updateConnectionType);
    }

    return () => {
      window.removeEventListener('online', updateOnlineStatus);
      window.removeEventListener('offline', updateOnlineStatus);

      if ('connection' in navigator) {
        navigator.connection.removeEventListener('change', updateConnectionType);
      }
    };
  }, []);

  return { isOnline, connectionType };
}