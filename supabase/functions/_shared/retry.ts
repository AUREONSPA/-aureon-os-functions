// Backoff exponencial: intento 1 -> 30 s, 2 -> 60 s, 3 -> 120 s ... con tope.
export function backoffSeconds(attempts: number, baseSeconds = 30, capSeconds = 3600): number {
  const exp = Math.max(attempts - 1, 0);
  return Math.min(capSeconds, baseSeconds * 2 ** exp);
}
