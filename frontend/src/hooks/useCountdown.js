import { useState, useEffect } from "react";

export function useCountdown(secondsRemaining) {
  const [seconds, setSeconds] = useState(secondsRemaining || 0);

  useEffect(() => {
    setSeconds(secondsRemaining || 0);
  }, [secondsRemaining]);

  useEffect(() => {
    if (seconds <= 0) return;
    const timer = setInterval(() => setSeconds((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, [seconds]);

  const hours   = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs    = seconds % 60;

  return {
    hours,
    minutes,
    secs,
    totalSeconds: seconds,
    expired: seconds <= 0,
    formatted: `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`,
  };
}
