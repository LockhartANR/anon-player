export const openmsOrigin = 'https://openms.top';

export function parseOpenMsReplayId(input: string): string {
  const text = input.trim();
  let digits = /^\d+$/.test(text) ? text : undefined;
  if (!digits) {
    try {
      const url = new URL(text);
      if (url.origin === openmsOrigin && url.pathname === '/' && !url.username && !url.password) {
        digits = url.hash.match(/^#\/video\/(\d+)\/?(?:\?.*)?$/)?.[1];
      }
    } catch { /* An invalid URL is handled by the input error below. */ }
  }
  const id = Number(digits);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error(`请输入正整数录像 ID，或 ${openmsOrigin}/#/video/… 链接。`);
  }
  return String(id);
}

function replayFilename(disposition: string | null): string {
  const filename = disposition?.match(/(?:^|;\s*)filename\*=UTF-8''([^;]+)/i)?.[1]
    ?? disposition?.match(/(?:^|;\s*)filename=(?:"([^"]+)"|([^;]+))/i)?.slice(1).find(Boolean);
  if (!filename) throw new Error('开源扫雷网响应缺少录像文件名。');
  try { return decodeURIComponent(filename); }
  catch { return filename; }
}

export async function fetchOpenMsReplay(id: string, signal: AbortSignal): Promise<{ filename: string; bytes: ArrayBuffer }> {
  const deadline = AbortSignal.timeout(15000);
  const requestSignal = AbortSignal.any([signal, deadline]);
  try {
    const response = await fetch(`${openmsOrigin}/api/video/download/${encodeURIComponent(id)}`, {
      credentials: 'omit', redirect: 'error', signal: requestSignal,
    });
    if (response.status === 404) throw new Error('找不到这条开源扫雷网录像，请检查 ID 或链接。');
    if (response.status === 403) throw new Error('这条开源扫雷网录像当前无法公开读取。');
    if (response.status === 429) throw new Error('开源扫雷网下载请求过于频繁，请稍后再试。');
    if (!response.ok) throw new Error(`开源扫雷网暂时无法读取录像（HTTP ${response.status}）。`);
    if (!/^application\/octet-stream(?:;|$)/i.test(response.headers.get('content-type') ?? '')) {
      throw new Error('开源扫雷网返回的内容不是录像文件。');
    }
    const filename = replayFilename(response.headers.get('content-disposition'));
    const bytes = await response.arrayBuffer();
    return { filename, bytes };
  } catch (error) {
    signal.throwIfAborted();
    if (deadline.aborted) throw new Error('读取开源扫雷网录像超时，请重试。');
    if (error instanceof TypeError) throw new Error('无法连接开源扫雷网，请检查网络后重试。');
    throw error;
  }
}
