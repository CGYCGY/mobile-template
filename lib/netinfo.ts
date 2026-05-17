import { useEffect, useState } from 'react';
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';

function deriveIsOnline(state: NetInfoState): boolean {
  if (state.isConnected == null) return true;
  if (state.isInternetReachable == null) return state.isConnected;
  return state.isConnected && state.isInternetReachable;
}

export function useIsOnline(): boolean {
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    let cancelled = false;

    NetInfo.fetch().then((state) => {
      if (!cancelled) setIsOnline(deriveIsOnline(state));
    });

    const unsubscribe = NetInfo.addEventListener((state) => {
      if (!cancelled) setIsOnline(deriveIsOnline(state));
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return isOnline;
}
