/** Only transport failures are retryable; application/tool errors are not. */
export function isMcpConnectionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /connection closed|not connected|transport.*closed|EPIPE|ECONNRESET|socket hang up|MCP startup timeout/i.test(message);
}

export async function retryMcpRead<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (!isMcpConnectionError(error)) throw error;
    return read();
  }
}
