export type ToastType = "error" | "info" | "success";

export interface ToastPayload {
  message: string;
  type: ToastType;
}

const TOAST_EVENT = "app-toast";

/** 全局轻量提示：替代原生 alert，不阻塞、风格统一 */
export function toast(message: string, type: ToastType = "info") {
  window.dispatchEvent(new CustomEvent<ToastPayload>(TOAST_EVENT, { detail: { message, type } }));
}

toast.error = (message: string) => toast(message, "error");
toast.success = (message: string) => toast(message, "success");

export function onToast(listener: (payload: ToastPayload) => void): () => void {
  const handler = (e: Event) => listener((e as CustomEvent<ToastPayload>).detail);
  window.addEventListener(TOAST_EVENT, handler);
  return () => window.removeEventListener(TOAST_EVENT, handler);
}
