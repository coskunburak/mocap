export function createFpsCounter(windowMs = 1000) {
  let times: number[] = [];

  return {
    tick(nowMs: number) {
      times.push(nowMs);
      const cutoff = nowMs - windowMs;
      while (times.length && times[0] < cutoff) times.shift();
      return times.length; // ~fps
    },
  };
}
