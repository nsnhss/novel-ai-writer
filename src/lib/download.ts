/** 触发浏览器下载（Tauri WebView 内会走系统下载/保存流程） */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function downloadText(content: string, fileName: string, mime: string): void {
  downloadBlob(new Blob([content], { type: mime }), fileName);
}

/** Tauri 命令返回的 Vec<u8> 会被序列化为 number[] */
export function downloadBinary(data: number[], fileName: string, mime: string): void {
  downloadBlob(new Blob([new Uint8Array(data)], { type: mime }), fileName);
}
