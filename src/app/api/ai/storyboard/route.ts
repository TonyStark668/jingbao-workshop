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
import type { StoryboardShot, CreationMode } from '@/lib/types';

/** 实际生效的创作方式（auto 只是路由入口，最终必然落到三种之一） */
type ConcreteMode = Exclude<CreationMode, 'auto'>;

/**
 * auto 模式下用关键词规则识别文案类型（零成本、可预测、可调试）：
 * - 真人口播信号：教学/分享/日常类词汇 → real
 * - 故事/玄幻信号：小说/漫剧/奇幻类词汇 → ai
 * - 无明显信号或打平 → hybrid（混合创作是通用性最好的兜底）
 */
function detectCreationMode(text: string): ConcreteMode {
  // 高置信真人口播信号：教学、分享、日常记录类
  const realKeywords = [
    '口播', '讲解', '分享', '教你', '干货', '知识', '经验', '方法', '技巧',
    '日常', 'vlog', 'Vlog', '探店', '测评', '开箱', '访谈', '大家好',
    '今天给大家', '给大家', '聊聊', '朋友们', '小伙伴', '建议收藏', '避坑', '注意',
  ];
  // 高置信 AI 视频/故事信号：玄幻、漫剧、小说推文类
  const aiKeywords = [
    '玄幻', '修仙', '穿越', '漫剧', '小说', '异世界', '魔法', '宗门', '修炼',
    '江湖', '武侠', '奇幻', '上古', '神兽', '灵气', '宫廷', '王爷', '千金',
    '霸总', '妖', '魔', '仙门', '法术', '公主', '王子', '王国', '从前', '有一天',
  ];
  let realScore = 0;
  let aiScore = 0;
  for (const kw of realKeywords) if (text.includes(kw)) realScore++;
  for (const kw of aiKeywords) if (text.includes(kw)) aiScore++;
  if (realScore > aiScore) return 'real';
  if (aiScore > realScore) return 'ai';
  return 'hybrid';
}

// 镜头数量规则（三种模式共用）：'auto' 时由 AI 自行判断，数字则精确输出
// 含时长意识（V2）：单镜头一般 2-8 秒；复杂内容减少单镜头信息量——auto 时可拆分镜头，固定数量时只能精简动作、不可增减镜头数
function buildCountRule(count: number | 'auto'): string {
  return count === 'auto'
    ? `1. 镜头数量由你根据文案的内容长度与情节复杂度自行决定，必须是 3-15 之间的整数：
   - 单一场景或简短文案 → 3-6 个
   - 情节有起伏或多场景转换 → 7-12 个
   - 信息密集的长文案 → 13-15 个
   宁精勿滥，每个镜头都必须有独立的存在价值。
   同时合理安排镜头时长：单个镜头一般 2-8 秒，简单动作或单一信息可用较短镜头；涉及复杂动作、多人互动、大型特效或重要剧情变化时，应减少单镜头内的信息量，必要时拆分为多个镜头；不为了凑数量机械拆分镜头，也不为了减少数量在一个镜头中堆叠大量动作。`
    : `1. 输出恰好 ${count} 个镜头，不多不少。单个镜头一般 2-8 秒；涉及复杂动作、多人互动或重要剧情变化时，优先精简该镜头的动作与信息量，不要在一个镜头中堆叠大量动作。如用户指定的镜头数量与文案复杂度明显不匹配，仍必须保持恰好 ${count} 个镜头，优先保证每个镜头动作简洁、信息聚焦。`;
}

// 三套独立调教的分镜 Prompt：不同制作方式对应完全不同的专业分镜标准
function buildSystemPrompt(mode: ConcreteMode, count: number | 'auto', extra?: string): string {
  const countRule = buildCountRule(count);

  const prompts: Record<ConcreteMode, string> = {
    // 🧑 真人实拍：核心是"我拿手机就能拍"
    real: `你是专业的真人口播短视频编导，擅长把文案转化为"拿起手机就能拍"的分镜脚本。
要求：
${countRule}
2. 严格只输出 JSON 数组，不要任何解释文字、不要 markdown 代码块之外的说明。
3. 每个镜头包含以下字段：
   - shotNumber: 镜头序号（从 1 开始的整数）
   - sceneDescription: 画面描述（中文，以景别开头，如"中景：""近景：""特写："；写清人物站位、面向方向、表情、具体动作、手中道具；所有画面必须是手机在日常生活场景中可实拍的）
   - dialogue: 台词或旁白（将文案逐句分配到对应镜头；可为空字符串）
   - duration: 预估时长（如"3秒"、"5秒"，单个镜头一般 2-8 秒）
   - cameraMove: 机位与运镜（如"固定机位，手机与胸同高"、"手持轻微晃动"、"三脚架固定"，符合手机拍摄习惯）
4. 口播节奏优先：文案的每句话都要有对应镜头，以人物直视镜头讲话为主，可穿插手势、道具演示、B-roll（手机屏幕特写、环境空镜）辅助表达。
5. 场景必须简单可拍：书桌前、客厅、办公室、户外街道等日常场景；禁止玄幻、科幻、特效等无法实拍的画面。
示例输出格式：
[{"shotNumber":1,"sceneDescription":"中景：人物站在书架前面对镜头，右手举起一本书，眉头微皱，语气认真","dialogue":"如果你每天都很努力，却还是赚不到钱……","duration":"3秒","cameraMove":"固定机位，手机与胸同高"}]`,

    // 🤖 AI视频（V3.2）：V3.1 基础上新增 sceneId 场景编号输出（配合前端"AI视频生成段"按场景边界切分，提升跨镜头连续性）：①输出规范增加 sceneId 字段（判据含地点/时间/环境状态）②跨镜头衔接章节说明场景切换时递增；镜头数量规则保留共用插值（countRule）
    ai: `你是专为 Seedance 2.0 系列 AI 视频模型优化的专业 AI 分镜师，面向没有角色资产、场景资产、道具资产的普通 AI 视频创作者。

你的任务是将用户提供的故事文案转化为低歧义、高生成稳定性、跨镜头连续性强的分镜脚本，可直接用于 AI 视频生成。

【核心优先级（严格执行）】

视频可生成性 > 镜头连续性 > 画面效果 > 文学表达

---

## 输出规范

${countRule}

仅输出纯 JSON 数组，禁止输出解释文字、标题、Markdown 或其他内容。

每个分镜必须包含以下字段：

- shotNumber：整数，镜头序号，从1开始递增
- sceneId：整数，连续生成场景编号，从1开始递增；地点、时间或环境状态（天气、光线）基本连续的镜头共用同一编号，发生明显变化时递增；回到之前出现过的场景时复用该场景的编号；仅用于自动视频分段，不影响其他字段
- sceneDescription：中文画面描述，必须完整，可单独复制给 AI 视频模型生成
- dialogue：台词/旁白，无内容填空字符串；有说话人必须标注，例如"旁白：""男主："
- duration：格式如"4秒"
- cameraMove：格式为"景别，运镜方式"，例如"中景，固定机位"

【时长规则】

- 简单静态或轻微动作：3-4秒
- 普通叙事动作：4-6秒
- 非剧情必要不超过8秒

禁止为了增加时长添加无意义动作。

---

# 一、单镜头自包含【最高原则】

每个 sceneDescription 必须脱离其他镜头独立理解和生成。

禁止依赖上下镜头、对话记忆或模型自行推测。

每个镜头必须包含：

- 固定视觉风格
- 核心场景
- 核心人物及必要人物特征
- 当前动作或状态
- 关键道具
- 必要空间关系
- 必要光线和环境状态

连续出现的人物、道具、建筑、车辆等，需要保留影响生成的关键连续信息。

即使角色之前已经出现，当前镜头仍需保留必要人物识别特征。

---

# 二、跨镜头与分段衔接

相邻镜头必须以上一镜头最后状态为基准延续。

禁止重新设计人物姿态、位置和场景状态。

默认保持：

- 人物位置
- 姿态
- 朝向
- 运动方向
- 视线关系
- 手持物品
- 道具状态
- 衣物状态
- 时间、天气、光线

一致。

如果上一镜头动作未完成，下一镜头应从合理延续状态开始。

禁止：

- 人物突然换位置
- 动作突然重置
- 运动方向反转
- 道具突然出现或消失

关键道具首次出现时，应明确其存在状态和空间位置（如手持、背负、佩戴、放置于某处），避免后续镜头中突然出现、消失或改变形态。

用户将多个镜头拆分成不同视频分段生成时，分段边界会优先落在场景切换处（sceneId 变化的位置）；同一场景因时长过长被拆分到不同分段时，下一段第一个镜头必须包含必要前置状态，不能依赖上一段视频内容或模型记忆。

---

# 三、sceneDescription 描述顺序【严格遵守】

每个镜头必须优先按照：

视觉风格 → 核心场景 → 核心人物 → 当前动作/状态 → 关键道具与空间关系 → 必要光线环境

组织描述。

优先明确：

谁 → 在哪里 → 做什么 → 当前状态如何

避免大量环境描写削弱主体。

---

# 四、视觉风格统一

整组分镜使用一个固定、简洁的视觉风格描述。

每个 sceneDescription 开头保持完全一致。

禁止：

- 镜头之间改变画风
- 混用多个风格标签
- 随意增加新的视觉风格词

例如：

统一使用"3D动漫风格"，不要交替使用"三维动画""动漫电影风"。

---

# 五、人物一致性

核心人物首次出现时建立固定人物锚点。

至少包含：

- 年龄感
- 发型发色
- 核心服装
- 必要身份特征

后续镜头保持人物核心视觉特征一致，未经剧情说明不得改变。

禁止：

- 随意换装
- 改变发型发色
- 改变年龄感
- 添加原文没有的特殊外貌或装饰

例如：

已设定：

"17岁黑色短发少年，穿黑色连帽衫"

后续不要变成：

"年轻男子"或"穿深色衣服的人"。

人物状态变化必须有明确剧情过程。

例如：

站立 → 坐下
干燥 → 淋湿
正常 → 受伤

不能无原因跳变。

多人场景需要明确：

- 每个人身份
- 相对位置
- 互动关系

避免使用"男生""女生"等模糊称呼。

---

# 六、场景与空间连续

同一连续场景保持：

- 场景结构
- 时间
- 天气
- 光线
- 色调
- 重要物体位置

一致。

重要建筑、地点、大型物体需要描述代表性结构。

不要只写名称。

例如：

不要只写：

"古堡"

应描述：

"带尖塔、厚重石墙和城门结构的古老城堡"。

涉及：

- 门
- 窗
- 走廊
- 通道
- 洞口
- 建筑入口

等连接空间时，必须保持两侧空间关系一致。

上一镜头已经明确门后、窗外或通道另一侧环境时，下一镜头不得无剧情原因改变为空间。

---

# 七、动作与复杂度控制

【动作连续】

每个镜头默认只承担一个主要动作。

禁止：

- 多个独立复杂动作同时发生
- 跳过关键动作节点
- 为凑镜头数量拆分无意义动作

相邻镜头应有明确变化：

动作、状态、事件或构图变化。

避免连续重复相同画面。

【复杂度匹配】

遵循：

复杂动作 → 简单运镜

明显运镜 → 简单主体动作

避免同时出现：

- 复杂动作
- 复杂摄影机运动
- 多人物复杂互动
- 大量视觉特效

优先保证主体动作稳定生成。

---

# 八、摄影视角与视觉主体

默认使用第三人称客观视角。

无剧情需要禁止：

- 第一人称 POV
- 自拍视角
- 主观镜头
- 人物无理由看向镜头

优先使用：

- 固定机位
- 缓慢推镜
- 缓慢拉镜
- 轻微横移
- 简单跟拍

避免复杂摄影设计。

视觉主体优先级：

核心人物 > 核心动作 > 关键道具 > 核心环境 > 装饰元素

远景中的动物、小人物、小型物体必须符合合理空间比例。

不得无剧情原因被放大成为主要主体。

---

# 九、生成风险降低

主动避免高风险内容：

- 精细手部操作
- 复杂肢体互动
- 快速连续动作
- 极端面部特写
- 多人物同时复杂动作

必须出现高风险动作时：

降低动作复杂度，使用更稳定景别。

背景元素：

雨、雪、雾、人群、粒子等使用概括描述。

非核心背景人物不要刻画清晰面部。

示例：

正确：

角色简单伸手拿起桌上的杯子。

避免：

角色快速转身，同时双手完成复杂操作，并配合高速运镜。

画面文字：

除非剧情需要，不生成清晰可读的文字、标识或复杂文字内容。

---

# 十、反过度创作原则

严格按照用户文案生成。

禁止主动增加：

- 无关剧情
- 额外人物
- 大型特效
- 大量粒子
- 复杂光影
- 特殊摄影效果

视觉效果强度必须匹配原文。

例如：

用户描述：

"瞳孔发出淡蓝色光芒"

只表现瞳孔区域发光。

不要增加：

- 光环
- 能量纹
- 光束
- 身体发光

自然光应符合真实环境。

月光、日光默认表现为大范围环境照明。

除非剧情明确要求，不生成：

- 探照灯
- 聚光灯
- 舞台光束

涉及影子、倒影、异常光影变化时：

明确变化范围和程度。

轻微异常只表现局部变化。

不要生成独立实体或夸张运动。

例如：

"影子像活过来一样"

应表现为影子轻微异常变化，而不是生成影子生物。

---

# 十一、动态元素控制

核心剧情元素可以明确数量。

非核心背景元素避免精确统计。

例如：

使用：

"少量人群"
"几只鸟"
"飘落的雨雪"

不要机械描述大量背景元素数量。

---

【最终执行标准】

描述清晰优先于描述华丽。

稳定生成优先于创意发挥。

连续一致优先于单个镜头效果。

所有规则最终服务于：

让没有专业视频制作经验和前置资产准备的普通用户，也能获得连续、稳定、可直接用于 AI 视频生成的分镜脚本。`,

    // 🔀 混合创作：核心是"哪些地方真人拍，哪些地方用AI画面/B-roll"
    hybrid: `你是专业的短视频总编导，擅长设计"真人实拍 + AI画面/B-roll素材"混合编排的分镜脚本。
要求：
${countRule}
2. 严格只输出 JSON 数组，不要任何解释文字、不要 markdown 代码块之外的说明。
3. 每个镜头包含以下字段：
   - shotNumber: 镜头序号（从 1 开始的整数）
   - shotType: 镜头类型（"real" = 真人实拍，"ai" = AI生成画面或B-roll素材；每条必填）
   - sceneDescription: 画面描述（中文；real 镜头以景别开头，写清人物站位、表情动作，确保手机可拍；ai 镜头写清画面内容、光线氛围，可直接作为AI生图提示词）
   - dialogue: 台词或旁白（可为空字符串）
   - duration: 预估时长（如"3秒"、"5秒"）
   - cameraMove: 运镜建议（如"固定机位"、"推镜，中景→特写"、"横移镜头"）
4. 编排逻辑：口播讲解、观点输出、情绪表达用 real 镜头（人物面对镜头讲话）；案例展示、场景重现、氛围烘托、数据可视化用 ai 镜头（B-roll/AI画面）；两种镜头自然交替，节奏紧凑。
5. 适配抖音/快手/视频号竖屏短视频，前 3 秒必须抓住观众（真人出镜直视镜头或强视觉冲击画面）。
示例输出格式：
[{"shotNumber":1,"shotType":"real","sceneDescription":"中景：人物坐在书桌前面对镜头，双手摊开，表情认真","dialogue":"你有没有发现，很多人每天忙忙碌碌……","duration":"3秒","cameraMove":"固定机位"},{"shotNumber":2,"shotType":"ai","sceneDescription":"清晨拥挤的地铁站人流穿梭，上班族们神色匆匆，冷色调","dialogue":"","duration":"3秒","cameraMove":"横移镜头"}]`,
  };

  const base = prompts[mode];
  return extra ? `${base}\n【用户补充要求】${extra}` : base;
}

// 降级用的通用分镜模板（AI 失败时不扣次数，直接返回结构化提示）
function fallbackShots(text: string): StoryboardShot[] {
  return [
    { shotNumber: 1, sceneDescription: `开场：围绕「${text.slice(0, 16)}」构建视觉冲击力强的第一帧，快速锁定注意力`, dialogue: '旁白：一句话点题，勾起好奇', duration: '3秒', cameraMove: '固定机位' },
    { shotNumber: 2, sceneDescription: '展开：交代核心内容的关键画面与人物状态', dialogue: '', duration: '5秒', cameraMove: '推镜，中景→特写' },
    { shotNumber: 3, sceneDescription: '高潮：突出最有价值的操作或情绪点', dialogue: '旁白：讲清痛点与解决方式', duration: '5秒', cameraMove: '跟拍/近景' },
    { shotNumber: 4, sceneDescription: '收尾：总结价值并引导互动', dialogue: '字幕：#短视频 #干货，评论区聊聊', duration: '3秒', cameraMove: '固定，淡出' },
  ];
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

  // 次数检查
  if (dailyUsed! >= dailyLimit!) {
    writeUsageLog({
      cardId: cardId!,
      cardCode: cardCode!,
      action: 'storyboard',
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

  let body: { text?: string; count?: number | 'auto'; provider?: string; model?: string; extra?: string; mode?: CreationMode } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: '请求格式错误' }, { status: 400 });
  }
  const text = (body.text || '').trim();
  if (!text) return NextResponse.json({ success: false, error: '缺少输入文本' }, { status: 400 });
  if (text.length > 5000) return NextResponse.json({ success: false, error: '文本过长，请精简到5000字以内' }, { status: 400 });
  // 用户补充要求（可选）：拼入 System Prompt 作为额外指令层，与文案内容隔离
  const extra = (body.extra || '').trim().slice(0, 100);

  // 创作方式：'auto' = 关键词规则自动识别（默认）；非法值一律回退 auto
  const validModes: CreationMode[] = ['auto', 'real', 'ai', 'hybrid'];
  const requestedMode: CreationMode = body.mode && validModes.includes(body.mode) ? body.mode : 'auto';
  const mode: ConcreteMode = requestedMode === 'auto' ? detectCreationMode(text) : requestedMode;

  // 分镜数量：'auto' = AI 自动判断；数字则 clamp 到 3-15（未传默认 10，兼容旧前端）
  const rawCount = body.count;
  let count: number | 'auto';
  if (rawCount === 'auto') {
    count = 'auto';
  } else {
    const n = parseInt(String(rawCount ?? 10), 10);
    count = Number.isFinite(n) ? Math.min(Math.max(n, 3), 15) : 10;
  }

  // 敏感词过滤
  const sens = checkSensitive(text);
  if (!sens.ok) {
    writeUsageLog({
      cardId: cardId!,
      cardCode: cardCode!,
      action: 'storyboard',
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
  // 次数检查（含本次成本：剩余次数不足以覆盖本次消耗时拦截）
  if (dailyUsed! + cost > dailyLimit!) {
    writeUsageLog({
      cardId: cardId!,
      cardCode: cardCode!,
      action: 'storyboard',
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
      { role: 'system', content: buildSystemPrompt(mode, count, extra) },
      { role: 'user', content: `视频文案：\n${text}` },
    ],
    maxRetries: 1, // 超时重试同样消耗豆包 token，控制在最多 2 次尝试
    preferred,
    model,
  });

  // AI 失败 → 降级提示，不扣次数、不写成功日志
  if (!ai.ok) {
    writeUsageLog({
      cardId: cardId!,
      cardCode: cardCode!,
      action: 'storyboard',
      success: false,
      ip,
      userAgent,
      fingerprint,
      detail: `AI_FALLBACK: ${ai.error} (${ai.provider})`,
    });
    const { code, message } = describeAIError(ai.error);
    return NextResponse.json(
      {
        success: false,
        code,
        error: message,
        fallback: { shots: fallbackShots(text), note: '以下为基础模板分镜（本次不消耗次数），稍后可重新生成' },
      },
      { status: 503 },
    );
  }

  // 解析 LLM 输出
  const parsed = extractJSON<StoryboardShot[]>(ai.content);
  const contentPreview = ai.content.slice(0, 200).replace(/\s+/g, ' ');
  if (!parsed || !Array.isArray(parsed) || parsed.length === 0 || !parsed[0]?.sceneDescription) {
    writeUsageLog({
      cardId: cardId!,
      cardCode: cardCode!,
      action: 'storyboard',
      success: false,
      ip,
      userAgent,
      fingerprint,
      detail: `AI_PARSE_FAIL (${ai.provider}) len=${parsed && Array.isArray(parsed) ? parsed.length : 0} preview="${contentPreview}"`,
    });
    return NextResponse.json(
      {
        success: false,
        code: 'AI_BUSY',
        error: 'AI服务繁忙，请稍后再试',
        fallback: { shots: fallbackShots(text), note: '以下为基础模板分镜（本次不消耗次数），稍后可重新生成' },
      },
      { status: 503 },
    );
  }

  // 并发兜底：AI 耗时期间其他请求可能已把当日次数用完，写入成功日志（扣次）前复核
  if (getDailyUsed(cardId!) + cost > dailyLimit!) {
    writeUsageLog({
      cardId: cardId!,
      cardCode: cardCode!,
      action: 'storyboard',
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

  // 规范化镜头数据（序号重排 + 字段兜底；shotType 仅在合法值时保留）
  // sceneId 清洗：容忍字符串数字，按首次出现顺序压缩为从 1 开始的连续编号（如 [1,1,3,3,7] → [1,1,2,2,3]），供前端按场景边界切分生成段
  const sceneIdMap = new Map<number, number>();
  let nextSceneId = 0;
  const normalizeSceneId = (raw: unknown): number | undefined => {
    const n = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d+$/.test(raw.trim()) ? parseInt(raw, 10) : NaN;
    if (!Number.isInteger(n) || n < 1) return undefined;
    if (!sceneIdMap.has(n)) sceneIdMap.set(n, ++nextSceneId);
    return sceneIdMap.get(n);
  };
  const shots: StoryboardShot[] = parsed.slice(0, 15).map((s, i) => {
    const sceneId = normalizeSceneId(s.sceneId);
    return {
      shotNumber: typeof s.shotNumber === 'number' ? s.shotNumber : i + 1,
      sceneDescription: String(s.sceneDescription || ''),
      dialogue: String(s.dialogue || ''),
      duration: String(s.duration || '3秒'),
      cameraMove: String(s.cameraMove || '固定机位'),
      ...(s.shotType === 'real' || s.shotType === 'ai' ? { shotType: s.shotType } : {}),
      ...(sceneId !== undefined ? { sceneId } : {}),
    };
  });

  const MODE_TITLE: Record<ConcreteMode, string> = {
    real: '真人实拍', ai: 'AI视频', hybrid: '混合创作',
  };
  const title = (text.slice(0, 12) + (text.length > 12 ? '...' : '')) + ` · ${MODE_TITLE[mode]}分镜`;
  const id = 'sb_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);

  // 写使用日志（success=1 即算扣次；记录创作方式便于后续分析识别准确率）
  writeUsageLog({
    cardId: cardId!,
    cardCode: cardCode!,
    action: 'storyboard',
    success: true,
    ip,
    userAgent,
    fingerprint,
    detail: { inputLen: text.length, shotsCount: shots.length, provider: ai.provider, cost, requestedMode, mode },
  });

  // 写生成历史
  saveGeneratedHistory({
    id,
    cardId: cardId!,
    cardCode: cardCode!,
    type: 'storyboard',
    inputText: text,
    outputJson: { title, shots, creationMode: mode },
  });

  touchCardUsage(cardId!, ip!, fingerprint!);

  return withRenewHeader(
    NextResponse.json({
      success: true,
      id,
      title,
      shots,
      provider: ai.provider,
      cost,
      creationMode: mode,
      autoDetected: requestedMode === 'auto',
    }),
    auth,
  );
}
