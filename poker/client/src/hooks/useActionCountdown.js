import { useEffect, useState } from 'react';

// Returns remaining ms until `deadline` (updated every ~100ms).
export function useActionCountdown(deadline) {
  const [remaining, setRemaining] = useState(
    deadline ? Math.max(0, deadline - Date.now()) : null
  );

  useEffect(() => {
    if (!deadline) {
      setRemaining(null);
      return;
    }
    setRemaining(Math.max(0, deadline - Date.now()));
    const t = setInterval(() => {
      setRemaining(Math.max(0, deadline - Date.now()));
    }, 100);
    return () => clearInterval(t);
  }, [deadline]);

  return remaining;
}
