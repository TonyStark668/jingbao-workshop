// 跨工具文本预填：工具之间"拿去生成 XXX"的联动桥梁
// 写入方：润色结果页（→分镜/标题）、分镜结果页（→角色三视图）、历史详情页（→分镜）
// 消费方：各工具组件挂载时 consume，取到则回填输入框并清除，取不到返回 null
'use client';

const KEY = 'jb_tool_prefill';

/** 工具标识（与 /studio?tool= 参数一致） */
export type PrefillTarget = 'storyboard' | 'titles' | 'polish' | 'charviews';

export function setToolPrefill(target: PrefillTarget, text: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ target, text }));
  } catch {
    // localStorage 不可用（隐私模式等）时静默失败，不影响主流程
  }
}

/** 读取并清除预填；target 不匹配（用户先打开了别的工具）时保留数据返回 null */
export function consumeToolPrefill(target: PrefillTarget): string | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as { target?: string; text?: string };
    if (data.target !== target || typeof data.text !== 'string' || !data.text.trim()) return null;
    localStorage.removeItem(KEY);
    return data.text;
  } catch {
    return null;
  }
}
