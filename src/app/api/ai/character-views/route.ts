import { NextRequest, NextResponse } from 'next/server';
import { authenticateCard, withRenewHeader, checkSensitive } from '@/lib/server/auth';
import {
  writeUsageLog,
  touchCardUsage,
  saveGeneratedHistory,
  getExhaustedTip,
  getDailyUsed,
} from '@/lib/server/card-service';
import { callAI, extractJSON, PROVIDER_KEYS, getModelCost, describeAIError } from '@/lib/server/ai-provider';
import type { ProviderKey } from '@/lib/server/ai-provider';
import { checkGlobalGuard } from '@/lib/server/service-guard';

/**
 * 角色三视图提示词：从故事中识别核心角色（1-4 个），
 * 为每个角色生成可直接用于图像模型（即梦/Seedream 等）的三视图设定图提示词。
 * 人物锚点约定与「文本转分镜」AI 视频模式 V3.2 保持同源（年龄感/发型发色/核心服装/身份特征），
 * 用户拿参考图 + 分镜描述去生成视频时，文本锚点与视觉锚点描述一致，人物一致性最大化。
 */

const SYSTEM_PROMPT = `你是专业的 AI 绘画提示词工程师，擅长为图像生成模型（即梦、Seedream 等）编写角色设定图提示词。

用户会提供一段故事文案。你的任务：
1. 从故事中识别对剧情最重要的核心角色，1-4 个（识别优先级：主角 > 与主角有重要互动的角色 > 推动剧情的关键角色）。
2. 为每个角色建立固定的人物锚点，并生成一条可直接使用的「角色三视图提示词」。

【人物锚点要求】（与分镜工具的锚点约定一致）
每个角色的锚点必须包含：
- 年龄感
- 发型发色
- 核心服装
- 必要身份或外形特征（如眼镜、佩剑、猫耳等）

故事中有明确描述时严格按故事；描述不足时可合理补全，但必须是普通、稳定的特征。
禁止添加发光眼睛、机械义肢、翅膀、纹身等故事中不存在的夸张特征。

【三视图提示词要求】
每条提示词必须自包含，单独复制给图像生成模型即可直接使用，包含：
1. 统一的视觉风格短语：故事中有明确风格描述时严格沿用；没有时根据题材选择一种简洁风格（如"3D动画风格"、"治愈系2D动画风格"、"电影感写实风格"）。
2. 人物锚点：与上方建立的锚点完全一致，一个角色所有描述中不得漂移。
3. 三视图布局：同一画面中水平排列展示同一角色的正面、侧面、背面三个视角。
4. 全身像、自然站姿、纯色浅背景、统一均匀光线。
5. 画面无文字、无水印、无Logo。

严格只输出 JSON 数组，不要输出任何解释文字。每个元素是一个对象：
- name：角色名或称呼（来自故事；故事中没有名字时用身份称呼，如"黑发少年"）
- prompt：完整的三视图生成提示词，中文，一段连贯文字

示例输出格式：
[{"name":"角色名","prompt":"3D动画风格，25岁黑色短发男生，穿灰色连帽卫衣……同一画面水平排列展示正面、侧面、背面三个视角的全身像，自然站姿，纯色浅背景，统一均匀光线，画面无文字无水印" }]`;

interface CharacterView {
  name: string;
  prompt: string;
}

/** 清洗 LLM 输出的角色数组：过滤无效项、name 兜底、最多 4 个
 *  extractJSON 对截断的对象数组会退回"单个完整对象"（非数组），此处兼容包装 */
function cleanCharacters(raw: unknown): CharacterView[] {
  const items = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? [raw] : [];
  const list: CharacterView[] = [];
  for (const item of items) {
    if (typeof item === 'string' && item.trim()) {
      // 模型偶尔直接输出字符串数组：视为提示词
      list.push({ name: `角色${list.length + 1}`, prompt: item.trim() });
    } else if (item && typeof item === 'object') {
      const obj = item as { name?: unknown; prompt?: unknown };
      const prompt = typeof obj.prompt === 'string' ? obj.prompt.trim() : '';
      if (!prompt) continue;
      const name = typeof obj.name === 'string' && obj.name.trim() ? obj.name.trim().slice(0, 20) : `角色${list.length + 1}`;
      list.push({ name, prompt });
    }
    if (list.length >= 4) break;
  }
  return list;
}

export async function POST(request: NextRequest) {
  const auth = authenticateCard(request);
  if (!auth.ok) {
    return NextResponse.json(
      { success: false, code: auth.code, error: auth.error },
      { status: auth.status || 401 },
    );
  }
  const { cardId, cardCode, dailyUsed, dailyLimit, ip, fingerprint, userAgent } = auth;

  if (dailyUsed! >= dailyLimit!) {
    writeUsageLog({
      cardId: cardId!,
      cardCode: cardCode!,
      action: 'character_views',
      success: false,
      ip,
      userAgent,
      fingerprint,
      detail: 'DAILY_LIMIT',
    });
    return NextResponse.json(
      { success: false, code: 'DAILY_LIMIT', error: '今日AI生成次数已用完，请明天再来', tip: getExhaustedTip() },
      { status: 429 },
    );
  }

  let body: { text?: string; provider?: string; model?: string; extra?: string } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: '请求格式错误' }, { status: 400 });
  }
  const text = (body.text || '').trim();
  if (!text) return NextResponse.json({ success: false, error: '缺少故事文案' }, { status: 400 });
  if (text.length < 20) return NextResponse.json({ success: false, error: '故事太短啦，至少需要 20 个字（需要有人物和情节才能识别角色）' }, { status: 400 });
  if (text.length > 2000) return NextResponse.json({ success: false, error: '内容过长，请精简到2000字以内' }, { status: 400 });
  // 用户补充要求（可选）：主要用于补充/覆盖角色细节，如"男主穿红色连衣裙""主角要带佩剑"
  const extra = (body.extra || '').trim().slice(0, 100);

  const sens = checkSensitive(text);
  if (!sens.ok) {
    writeUsageLog({
      cardId: cardId!,
      cardCode: cardCode!,
      action: 'character_views',
      success: false,
      ip,
      userAgent,
      fingerprint,
      detail: `SENSITIVE: ${sens.hit}`,
    });
    return NextResponse.json({ success: false, error: '输入内容包含违规词，请修改后重试' }, { status: 400 });
  }

  // ========= 调用真实 LLM =========
  // 用户指定的 provider/model 需在白名单内（非法值直接忽略走默认）
  const preferred = PROVIDER_KEYS.includes(body.provider as ProviderKey) ? (body.provider as ProviderKey) : undefined;
  const model = typeof body.model === 'string' ? body.model : undefined;
  // 本次消耗次数（按模型档位成本加权）
  const cost = preferred && model ? getModelCost(preferred, model) : 1;
  // 次数检查（含本次成本）
  if (dailyUsed! + cost > dailyLimit!) {
    writeUsageLog({
      cardId: cardId!,
      cardCode: cardCode!,
      action: 'character_views',
      success: false,
      ip,
      userAgent,
      fingerprint,
      detail: 'DAILY_LIMIT',
    });
    return NextResponse.json(
      { success: false, code: 'DAILY_LIMIT', error: `今日剩余次数不足以完成本次生成（需${cost}次），请更换低档位模型或明天再来`, tip: getExhaustedTip() },
      { status: 429 },
    );
  }

  // 全局护栏：紧急暂停 + 全局每日上限（不通过时不扣次数）
  const guard = checkGlobalGuard();
  if (!guard.ok) {
    return NextResponse.json(
      { success: false, code: guard.code, error: guard.error },
      { status: 503 },
    );
  }

  const ai = await callAI({
    messages: [
      { role: 'system', content: extra ? `${SYSTEM_PROMPT}\n【用户补充要求】${extra}` : SYSTEM_PROMPT },
      { role: 'user', content: `故事文案：\n${text}` },
    ],
    maxRetries: 1,
    preferred,
    model,
    suppressThinking: true, // 纯格式化输出任务：关思考防 <think> 污染 JSON 解析
  });

  if (!ai.ok) {
    writeUsageLog({
      cardId: cardId!,
      cardCode: cardCode!,
      action: 'character_views',
      success: false,
      ip,
      userAgent,
      fingerprint,
      detail: `AI_FAIL: ${ai.error} (${ai.provider})`,
    });
    const { code, message } = describeAIError(ai.error);
    return NextResponse.json(
      {
        success: false,
        code,
        error: message,
      },
      { status: 503 },
    );
  }

  // 解析 LLM 输出：启用容错提取，响应被截断时也能取回完整的前缀角色
  const parsed = extractJSON<unknown[]>(ai.content, { partialArrays: true });
  const characters = cleanCharacters(parsed);
  if (characters.length < 1) {
    const contentPreview = ai.content.slice(0, 200).replace(/\s+/g, ' ');
    const truncFlag = ai.finishReason === 'length' ? ' TRUNCATED_BY_MAX_TOKENS' : '';
    writeUsageLog({
      cardId: cardId!,
      cardCode: cardCode!,
      action: 'character_views',
      success: false,
      ip,
      userAgent,
      fingerprint,
      detail: `AI_PARSE_FAIL (${ai.provider}) len=${characters.length} contentLen=${ai.content.length} finish=${ai.finishReason ?? '-'}${truncFlag} preview="${contentPreview}"`,
    });
    return NextResponse.json(
      { success: false, code: 'AI_BUSY', error: 'AI服务繁忙，请稍后再试' },
      { status: 503 },
    );
  }

  // 并发兜底：AI 耗时期间其他请求可能已把当日次数用完，写入成功日志（扣次）前复核
  if (getDailyUsed(cardId!) + cost > dailyLimit!) {
    writeUsageLog({
      cardId: cardId!,
      cardCode: cardCode!,
      action: 'character_views',
      success: false,
      ip,
      userAgent,
      fingerprint,
      detail: 'DAILY_LIMIT_RACE',
    });
    return NextResponse.json(
      { success: false, code: 'DAILY_LIMIT', error: '今日AI生成次数已用完，请明天再来', tip: getExhaustedTip() },
      { status: 429 },
    );
  }

  const id = 'cv_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);

  writeUsageLog({
    cardId: cardId!,
    cardCode: cardCode!,
    action: 'character_views',
    success: true,
    ip,
    userAgent,
    fingerprint,
    detail: { inputLen: text.length, charactersCount: characters.length, provider: ai.provider, cost },
  });

  saveGeneratedHistory({
    id,
    cardId: cardId!,
    cardCode: cardCode!,
    type: 'character_views',
    inputText: text,
    outputJson: { characters },
  });

  touchCardUsage(cardId!, ip!, fingerprint!);

  return withRenewHeader(NextResponse.json({ success: true, id, characters, provider: ai.provider, cost }), auth);
}
