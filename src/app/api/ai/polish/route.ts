import { NextRequest, NextResponse } from 'next/server';
import { authenticateCard, withRenewHeader, checkSensitive } from '@/lib/server/auth';
import {
  writeUsageLog,
  touchCardUsage,
  saveGeneratedHistory,
  getExhaustedTip,
  getDailyUsed,
} from '@/lib/server/card-service';
import { callAI, PROVIDER_KEYS, getModelCost } from '@/lib/server/ai-provider';
import type { ProviderKey } from '@/lib/server/ai-provider';
import { checkGlobalGuard } from '@/lib/server/service-guard';

/**
 * 文案润色（三模式）：polish 润色 / expand 扩写 / condense 缩写
 * 为后续「文本转分镜」优化的上游文案工具，输出纯文本（非 JSON）
 */

type PolishMode = 'polish' | 'expand' | 'condense';
const MODES: PolishMode[] = ['polish', 'expand', 'condense'];

const MODE_NAME: Record<PolishMode, string> = {
  polish: '润色',
  expand: '扩写',
  condense: '缩写',
};

// 三模式行为边界（与产品约定一致）：润色不改剧情 / 扩写不偏主线 / 缩写保留四要素
const MODE_RULES: Record<PolishMode, string> = {
  polish: `【润色模式规则】
1. 不改变原有剧情、人物、事件顺序和结局，只提升表达质量。
2. 修正错别字、病句和不通顺的表达。
3. 增强画面感：把抽象、笼统的描述改写为具体、可看见的画面。
4. 让人物动作清晰、场景交代明确，台词或旁白标注清楚说话人。
5. 保留原文的叙事视角和语言风格基调，不注入原文没有的新剧情。`,
  expand: `【扩写模式规则】
1. 严格保持原故事的主线、核心人物、事件因果关系和结局，不得偏离。
2. 可以补充：人物心理、环境细节、动作过程、人物之间的对话互动。
3. 补充内容必须服务于原有剧情；禁止引入原文没有的新主线剧情或新的核心人物。
4. 把原文中一笔带过的关键节点展开为完整的过程描写。`,
  condense: `【缩写模式规则】
1. 必须保留四要素：核心人物、关键事件、因果关系、最终结局。
2. 删除冗余修饰、重复表达和次要细节，保留推进剧情所必需的信息。
3. 输出仍是完整流畅的故事，不是碎片化的要点摘要。
4. 不添加原文没有的内容。`,
};

function buildSystemPrompt(mode: PolishMode, lengthHint?: string, extra?: string): string {
  const parts = [
    `你是专业的短视频文案专家，擅长为 AI 视频分镜脚本生成优化故事文案。
用户会提供一段自己写的故事文案。你的任务是按「${MODE_NAME[mode]}」模式处理它，输出一段可以直接用于生成分镜脚本的故事正文。
${MODE_RULES[mode]}
【输出要求】
1. 只输出处理后的故事正文，禁止输出任何解释、标题、前言、Markdown 格式或分隔符。
2. 优先服务于后续的分镜脚本生成：画面感强、动作清晰、场景明确、人物特征具体稳定。`,
  ];
  if (lengthHint) parts.push(`【目标长度】输出约 ${lengthHint}。按范围控制即可，不追求精确字数，禁止为凑字数添加无意义内容。`);
  if (extra) parts.push(`【用户补充要求】${extra}`);
  return parts.join('\n');
}

/** 剥离思考块 / 代码块包装等杂质（纯文本输出任务的轻量清洗） */
function cleanPlainText(raw: string): string {
  let text = raw.replace(/<\s*(?:think|thinking)\s*>[\s\S]*?<\s*\/\s*(?:think|thinking)\s*>/gi, '');
  text = text.replace(/<\s*(?:think|thinking)\s*\/?\s*>/gi, '');
  // 模型偶尔会用代码块包裹正文：剥掉围栏保留内容
  const fence = text.match(/^```[\w-]*\s*\n([\s\S]*?)\n?```$/);
  if (fence) text = fence[1];
  return text.trim();
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
      action: 'polish',
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

  let body: { text?: string; mode?: string; lengthHint?: string; provider?: string; model?: string; extra?: string } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: '请求格式错误' }, { status: 400 });
  }
  const text = (body.text || '').trim();
  if (!text) return NextResponse.json({ success: false, error: '缺少故事文案' }, { status: 400 });
  if (text.length < 10) return NextResponse.json({ success: false, error: '文案太短啦，至少需要 10 个字' }, { status: 400 });
  if (text.length > 3000) return NextResponse.json({ success: false, error: '内容过长，请精简到3000字以内' }, { status: 400 });
  const mode = MODES.includes(body.mode as PolishMode) ? (body.mode as PolishMode) : 'polish';
  const lengthHint = (body.lengthHint || '').trim().slice(0, 30);
  // 用户补充要求（可选）：拼入 System Prompt 作为额外指令层，与文案内容隔离
  const extra = (body.extra || '').trim().slice(0, 100);

  const sens = checkSensitive(text);
  if (!sens.ok) {
    writeUsageLog({
      cardId: cardId!,
      cardCode: cardCode!,
      action: 'polish',
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
      action: 'polish',
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
      { role: 'system', content: buildSystemPrompt(mode, lengthHint || undefined, extra || undefined) },
      { role: 'user', content: `故事文案：\n${text}` },
    ],
    maxRetries: 1,
    preferred,
    model,
    suppressThinking: true, // 纯文本输出任务：关思考防 <think> 污染正文
  });

  if (!ai.ok) {
    writeUsageLog({
      cardId: cardId!,
      cardCode: cardCode!,
      action: 'polish',
      success: false,
      ip,
      userAgent,
      fingerprint,
      detail: `AI_FAIL: ${ai.error} (${ai.provider})`,
    });
    return NextResponse.json(
      {
        success: false,
        code: 'AI_BUSY',
        error: ai.error === 'AI_PROVIDER_NOT_CONFIGURED'
          ? 'AI 服务尚未配置 API Key，请联系管理员在后台或环境变量中配置'
          : 'AI服务繁忙，请稍后再试',
      },
      { status: 503 },
    );
  }

  const resultText = cleanPlainText(ai.content);
  if (!resultText || resultText.length < 5) {
    const contentPreview = ai.content.slice(0, 200).replace(/\s+/g, ' ');
    writeUsageLog({
      cardId: cardId!,
      cardCode: cardCode!,
      action: 'polish',
      success: false,
      ip,
      userAgent,
      fingerprint,
      detail: `AI_PARSE_FAIL (${ai.provider}) contentLen=${ai.content.length} preview="${contentPreview}"`,
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
      action: 'polish',
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

  const id = 'pl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);

  writeUsageLog({
    cardId: cardId!,
    cardCode: cardCode!,
    action: 'polish',
    success: true,
    ip,
    userAgent,
    fingerprint,
    detail: { mode, inputLen: text.length, outputLen: resultText.length, provider: ai.provider, cost },
  });

  saveGeneratedHistory({
    id,
    cardId: cardId!,
    cardCode: cardCode!,
    type: 'polish',
    inputText: text,
    outputJson: { mode, text: resultText },
  });

  touchCardUsage(cardId!, ip!, fingerprint!);

  return withRenewHeader(NextResponse.json({ success: true, id, mode, text: resultText, provider: ai.provider, cost }), auth);
}
