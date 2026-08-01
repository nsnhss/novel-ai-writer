// 生成评分记忆：GenerationToolbar / AIPanel / RewriteDiffDialog 共用同一份上次评分
const RATING_KEY = "novelWriter:lastRating";

export function loadLastRating(): number {
  const v = Number(localStorage.getItem(RATING_KEY));
  return v >= 1 && v <= 5 ? v : 3;
}

export function saveLastRating(rating: number): void {
  localStorage.setItem(RATING_KEY, String(rating));
}
