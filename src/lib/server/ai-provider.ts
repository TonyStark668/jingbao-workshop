// AI Provider 封装层：6 家大模型统一走 OpenAI 兼容格式
// 配置读取顺序：system_config 表（管理后台可改） → 环境变量兜底
import { db } from './db';
import { decryptSecret } from './secret-box';

export type ProviderKey = 'qwen' | 'zhipu' | 'deepseek' | 'hunyuan' | 'doubao' | 'siliconflow';

interface ProviderDef {
  key: ProviderKey;
  label: string;
  baseURL: string;
  model: string;
  envKey: string;      // 存 API Key 的环境变量名
  envBaseURL?: string; // 可覆盖 baseURL 的环境变量名
  envModel?: string;   // 可覆盖 model 的环境变量名（全局兜底）
  envModelByTier?: Partial<Record<ModelTier, string>>; // 按档位分别覆盖模型的环境变量名（豆包特有：不同档位用不同 ep-ID）
  authPrefix?: string; // Authorization 头前缀，默认 "Bearer"；腾讯混元用 "token"
  timeoutMs?: number;  // 单独超时（毫秒），默认 30s
}

// 6 家提供商默认接入参数（全部兼容 OpenAI /chat/completions 格式）
const PROVIDERS: Record<ProviderKey, ProviderDef> = {
  qwen: {
    key: 'qwen', label: '通义千问',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-turbo',
    envKey: 'DASHSCOPE_API_KEY',
  },
  zhipu: {
    key: 'zhipu', label: '智谱AI',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-5.3-flash',
    envKey: 'ZHIPU_API_KEY',
  },
  deepseek: {
    key: 'deepseek', label: 'DeepSeek',
    baseURL: 'https://api.deepseek.com/v1',
    model: 'deepseek-flash',
    envKey: 'DEEPSEEK_API_KEY',
    // 兼容部署文档宣传的通用变量名（LLM_API_KEY/LLM_BASE_URL/LLM_MODEL）：
    // .env.example 一直让用户填 LLM_API_KEY，但此前代码从未读取，导致部署后 AI 全部报"服务繁忙"
    envBaseURL: 'LLM_BASE_URL',
    envModel: 'LLM_MODEL',
    timeoutMs: 90_000, // v4-pro 等旗舰模型推理慢，放宽到 90 秒
  },
  hunyuan: {
    key: 'hunyuan', label: '腾讯混元',
    baseURL: 'https://tokenhub.tencentmaas.com/v1',
    model: 'hy3',
    envKey: 'HUNYUAN_API_KEY',
    // TokenHub 官方文档（2026-08-28 版）明确 OpenAI 兼容路径使用标准 "Authorization: Bearer xxx"
    timeoutMs: 90_000, // hy4 等旗舰模型推理慢，放宽到 90 秒
  },
  doubao: {
    key: 'doubao', label: '字节豆包',
    baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
    model: 'doubao-lite-4k',
    envKey: 'DOUBAO_API_KEY',
    envModel: 'DOUBAO_MODEL', // 兜底（单接入点场景）
    // 多接入点场景：不同档位自动切不同 ep-ID
    envModelByTier: {
      fast: 'DOUBAO_MODEL_FAST',         // Seed-2.0-lite 极速
      standard: 'DOUBAO_MODEL_STANDARD',  // Seed-2.1-Turbo 标准（推荐）
      plus: 'DOUBAO_MODEL_PLUS',          // 高质量（没配则 fallback STANDARD）
      flagship: 'DOUBAO_MODEL_FLAGSHIP',  // 旗舰（没配则 fallback STANDARD）
    },
    timeoutMs: 180_000, // Seed 系列是思考型模型，深度思考+长输出耗时久，放宽到 3 分钟
  },
  siliconflow: {
    key: 'siliconflow', label: '硅基流动',
    baseURL: 'https://api.siliconflow.cn/v1',
    model: 'Qwen/Qwen2.5-7B-Instruct',
    envKey: 'SILICONFLOW_API_KEY',
  },
};

/** 全部提供商 key（校验用） */
export const PROVIDER_KEYS = Object.keys(PROVIDERS) as ProviderKey[];

/**
 * 模型档位（用户端展示语言）：
 * - fast   ⚡ 极速版：快、便宜/免费，扣 1 次
 * - standard 💎 标准版：均衡默认，扣 1 次
 * - plus   💎 高质量版：更强创意，扣 2 次
 * - flagship 👑 旗舰版：最强质量、稍慢，扣 3 次
 */
export type ModelTier = 'fast' | 'standard' | 'plus' | 'flagship';

export interface CatalogModel {
  id: string;
  label: string;   // 管理后台展示用（技术名+说明）
  tier: ModelTier; // 用户端档位
  note: string;    // 用户端一句话用途说明
}

/** 档位元信息（用户端展示统一来源） */
export const TIER_META: Record<ModelTier, { label: string; icon: string; cost: number; desc: string }> = {
  fast:     { label: '极速版', icon: '⚡', cost: 1, desc: '速度快，适合日常生成' },
  standard: { label: '标准版', icon: '💎', cost: 1, desc: '均衡之选，文案质量佳' },
  plus:     { label: '高质量版', icon: '💎', cost: 2, desc: '更强创意，适合精写' },
  flagship: { label: '旗舰版', icon: '👑', cost: 3, desc: '最强质量，速度稍慢' },
};

/** 每家服务商的精选模型清单（管理后台下拉可选；tier/note 供用户端档位展示） */
export const MODEL_CATALOG: Record<ProviderKey, CatalogModel[]> = {
  qwen: [
    { id: 'qwen-flash', label: 'qwen-flash · 免费额度，极低价', tier: 'fast', note: '响应迅捷，出片更快' },
    { id: 'qwen-turbo', label: 'qwen-turbo · 低价高速（默认）', tier: 'fast', note: '速度快，适合日常生成' },
    { id: 'qwen-plus', label: 'qwen-plus · 标准价，能力均衡', tier: 'plus', note: '更强创意，适合精写' },
    { id: 'qwen-max', label: 'qwen-max · 旗舰价，最强能力', tier: 'flagship', note: '最强质量，速度稍慢' },
  ],
  zhipu: [
    { id: 'glm-5.3-flash', label: 'glm-5.3-flash · 多模态极速（默认）', tier: 'fast', note: '多模态识图，低成本草稿生成，适合批量试稿' },
    { id: 'glm-5.3-flashx', label: 'glm-5.3-flashx · 多模态高速', tier: 'standard', note: '多模态识图，高速输出，算力高峰可降级 Flash' },
    { id: 'glm-5.1', label: 'glm-5.1 · 高质量纯文本', tier: 'plus', note: '纯文本，剧本深度润色（不支持图片）' },
    { id: 'glm-5.3', label: 'glm-5.3 · 旗舰纯文本', tier: 'flagship', note: '纯文本旗舰，强推理，复杂剧情创作，1M 上下文' },
  ],
  deepseek: [
    { id: 'deepseek-flash', label: 'deepseek-flash · V4.1 极速（默认）', tier: 'fast', note: '速度快，1M 上下文' },
    { id: 'deepseek-v4-pro', label: 'deepseek-v4-pro · V4 旗舰', tier: 'flagship', note: '最强质量，Agent 与 Coding 能力顶级' },
  ],
  hunyuan: [
    { id: 'hy3', label: 'hy3 · 默认（已开通）', tier: 'standard', note: '均衡之选，文案质量佳' },
    { id: 'hy4-preview', label: 'hy4-preview · 高质量旗舰（已开通）', tier: 'plus', note: '更强创意，适合精写' },
  ],
  doubao: [
    { id: 'doubao-lite-4k', label: 'doubao-seed-2-0-lite · 极速（默认）', tier: 'fast', note: '速度快，日常生成推荐' },
    { id: 'doubao-lite-32k', label: 'doubao-seed-2-0-lite · 极速长文本', tier: 'fast', note: '极速响应，支持长文案' },
    { id: 'doubao-pro-4k', label: 'doubao-seed-2-1-turbo · 标准（推荐）', tier: 'standard', note: '质量速度平衡，适合日常生成' },
    { id: 'doubao-pro-32k', label: 'doubao-seed-2-1-pro · 最强旗舰', tier: 'flagship', note: '最强质量，适合精写' },
  ],
  siliconflow: [
    { id: 'Qwen/Qwen2.5-7B-Instruct', label: 'Qwen2.5-7B · 免费额度（默认）', tier: 'fast', note: '响应迅捷，出片更快' },
    { id: 'THUDM/glm-4-9b-chat', label: 'glm-4-9b · 免费额度', tier: 'fast', note: '响应迅捷，出片更快' },
    { id: 'Qwen/Qwen2.5-72B-Instruct', label: 'Qwen2.5-72B · 标准价，能力强', tier: 'plus', note: '更强创意，适合精写' },
    { id: 'deepseek-ai/DeepSeek-V3', label: 'DeepSeek-V3 · 标准价', tier: 'plus', note: '更强创意，适合精写' },
  ],
};

/** 读取 system_config 单值 */
function getSystemConfig(key: string): string | null {
  try {
    const row = db.prepare('SELECT value FROM system_config WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value ?? null;
  } catch {
    return null;
  }
}

/** 提供商是否启用（system_config 里 ai_enabled_xxx = '0' 表示手动停用；缺省 = 启用） */
function isProviderEnabled(key: ProviderKey): boolean {
  return getSystemConfig(`ai_enabled_${key}`) !== '0';
}

export interface ResolvedProvider {
  key: ProviderKey;
  label: string;
  baseURL: string;
  model: string;
  apiKey: string;
  authPrefix: string; // Authorization 头前缀
  timeoutMs: number;  // 超时毫秒数
}

/** 解析单个提供商的完整配置（Key 为空或已停用返回 null）；指定 model 时校验白名单 */
function resolveOne(key: ProviderKey, model?: string): ResolvedProvider | null {
  const def = PROVIDERS[key];
  if (!def) return null;
  if (!isProviderEnabled(key)) return null;
  const keyFromDb = getSystemConfig(`ai_key_${def.key}`);
  // 库中 Key 可能是 AES-256-GCM 密文（enc:v1: 前缀）或历史明文，decryptSecret 均兼容
  // deepseek 额外兼容通用变量 LLM_API_KEY（部署文档推荐的填法）
  const envApiKey =
    process.env[def.envKey] || (key === 'deepseek' && process.env.LLM_API_KEY) || '';
  const apiKey = (keyFromDb ? decryptSecret(keyFromDb) : '') || envApiKey || '';
  if (!apiKey) return null;
  const baseURL = (def.envBaseURL && process.env[def.envBaseURL]) || def.baseURL;

  /** 豆包多接入点：根据模型档位挑 env 变量；没配则回退到 STANDARD / envModel / 模型名 */
  function resolveDoubaoByTier(modelId: string): string {
    if (key !== 'doubao' || !def.envModelByTier) return modelId;
    const tier = MODEL_CATALOG.doubao.find((m) => m.id === modelId)?.tier;
    if (tier) {
      // 优先用当前档位 env → 没配回退到 STANDARD → 再回退到全局 DOUBAO_MODEL → 最后用模型名本身
      const tierEnv = def.envModelByTier[tier];
      const standardEnv = def.envModelByTier.standard;
      const byTier =
        (tierEnv && process.env[tierEnv]) ||
        (standardEnv && process.env[standardEnv]) ||
        (def.envModel && process.env[def.envModel]);
      if (byTier) return byTier;
    }
    // 无档位信息时用兜底 env
    return (def.envModel && process.env[def.envModel]) || modelId;
  }

  // 用户指定模型必须在目录白名单内；未指定走后台配置/默认
  let resolvedModel: string;
  if (model) {
    if (!MODEL_CATALOG[key].some((m) => m.id === model)) return null;
    resolvedModel = resolveDoubaoByTier(model);
  } else {
    // 自动匹配：先找 STANDARD 档位 env → 再找兜底 env → 后台配置 → 代码默认
    if (key === 'doubao' && def.envModelByTier?.standard && process.env[def.envModelByTier.standard]) {
      resolvedModel = process.env[def.envModelByTier.standard]!;
    } else {
      resolvedModel = (def.envModel && process.env[def.envModel]) || getSystemConfig(`ai_model_${def.key}`) || def.model;
    }
  }
  return { key: def.key, label: def.label, baseURL, model: resolvedModel, apiKey, authPrefix: def.authPrefix || 'Bearer', timeoutMs: def.timeoutMs || 60_000 };
}

/**
 * 解析当前生效的提供商配置（system_config 优先，环境变量兜底）
 * 若首选提供商未配置 Key，自动回退到第一个已配置 Key 的提供商
 * 指定 model 时校验是否在该提供商目录白名单内（防注入任意模型刷高价接口）
 */
export function resolveProvider(preferred?: ProviderKey, model?: string): ResolvedProvider | null {
  const wanted = (preferred || (getSystemConfig('default_provider') as ProviderKey | null)) || 'qwen';
  const first = resolveOne(wanted, model);
  if (first) return first;

  // 回退：按固定顺序找第一个已配置 Key 的提供商（回退时不保留用户指定模型）
  for (const k of PROVIDER_KEYS) {
    const fallback = resolveOne(k);
    if (fallback) return fallback;
  }
  return null;
}

/** 全部提供商与配置状态（管理后台展示用，不返回密钥明文） */
export function listProviders() {
  return (Object.keys(PROVIDERS) as ProviderKey[]).map((k) => {
    const def = PROVIDERS[k];
    const keyFromDb = getSystemConfig(`ai_key_${def.key}`);
    const envApiKey =
      process.env[def.envKey] || (k === 'deepseek' && process.env.LLM_API_KEY) || '';
    const currentModel = (def.envModel && process.env[def.envModel]) || getSystemConfig(`ai_model_${def.key}`) || def.model;
    return {
      key: def.key,
      label: def.label,
      defaultModel: def.model,
      currentModel,
      enabled: isProviderEnabled(k),
      // 当前模型是否来自后台自定义（非预设清单内 → 自定义；或存了 ai_model_ 也算自定义选择）
      modelCustom: !!getSystemConfig(`ai_model_${def.key}`) && !MODEL_CATALOG[k].some((m) => m.id === currentModel),
      models: MODEL_CATALOG[k],
      configured: !!(keyFromDb || envApiKey),
      configuredFrom: keyFromDb ? '后台配置' : (envApiKey ? '环境变量' : '未配置'),
    };
  });
}

/** 档位开放级别（管理后台可收窄用户可选范围） */
export type TierAccess = 'all' | 'standard' | 'plus';

const TIER_ORDER: ModelTier[] = ['fast', 'standard', 'plus', 'flagship'];

/** 读取后台配置的开放档位：all=全开 / standard=到标准版 / plus=到高质量版 */
export function getTierAccess(): TierAccess {
  const v = getSystemConfig('tier_access');
  if (v === 'standard' || v === 'plus') return v;
  return 'all';
}

function tierAllowed(tier: ModelTier, access: TierAccess): boolean {
  const limit = access === 'standard' ? 1 : access === 'plus' ? 2 : 3; // TIER_ORDER 下标上限
  return TIER_ORDER.indexOf(tier) <= limit;
}

/**
 * 用户端可选模型列表（只返回已配置 Key 的服务商，不暴露 Key）：
 * 自动附「自动匹配」由前端渲染；此处返回各服务商模型（含档位/成本/说明）
 */
export function listUserModels() {
  const access = getTierAccess();
  const defaultProvider = (getSystemConfig('default_provider') as ProviderKey | null) || 'qwen';
  const providers = PROVIDER_KEYS.filter((k) => {
    if (!isProviderEnabled(k)) return false;
    const def = PROVIDERS[k];
    return !!(getSystemConfig(`ai_key_${def.key}`) || process.env[def.envKey] || (k === 'deepseek' && process.env.LLM_API_KEY));
  });
  return {
    tierAccess: access,
    defaultProvider,
    providers: providers.map((k) => ({
      key: k,
      label: PROVIDERS[k].label,
      models: MODEL_CATALOG[k]
        .filter((m) => tierAllowed(m.tier, access))
        .map((m) => ({
          id: m.id,
          tier: m.tier,
          tierLabel: `${TIER_META[m.tier].icon} ${TIER_META[m.tier].label}`,
          cost: TIER_META[m.tier].cost,
          note: m.note,
        })),
    })),
  };
}

/** 查询某提供商某模型的扣次成本（白名单外返回 1，用于兜底） */
export function getModelCost(provider: ProviderKey, model: string): number {
  const m = MODEL_CATALOG[provider]?.find((x) => x.id === model);
  return m ? TIER_META[m.tier].cost : 1;
}

export interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

// ===== HTTPS_PROXY 代理支持（Node 内置 fetch 默认不走代理，沙箱/企业网环境必需）=====
// 注意：npm 版 undici 的 ProxyAgent 与 Node 内置 fetch（内部旧版 undici）不兼容，
// 因此启用代理时必须使用 undici 包自带的 fetch，而不是全局 fetch。
interface ProxyFetch {
  fetch: (url: string, init: Record<string, unknown>) => Promise<Response>;
}

let cachedProxyFetch: ProxyFetch | null | undefined;

/** 读取代理环境变量，返回带 ProxyAgent 的 fetch；无代理环境返回 null（用全局 fetch） */
function getProxyFetch(): ProxyFetch | null {
  if (cachedProxyFetch !== undefined) return cachedProxyFetch;
  cachedProxyFetch = null;
  const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
  if (!proxyUrl) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ProxyAgent, fetch: undiciFetch } = require('undici') as {
      ProxyAgent: new (url: string) => unknown;
      fetch: (url: string, init: Record<string, unknown>) => Promise<Response>;
    };
    const dispatcher = new ProxyAgent(proxyUrl);
    cachedProxyFetch = {
      fetch: (url: string, init: Record<string, unknown>) =>
        undiciFetch(url, { ...init, dispatcher }),
    };
  } catch {
    // undici 不可用时忽略，直连
  }
  return cachedProxyFetch;
}

export interface CallAIOptions {
  messages: ChatMessage[];
  timeoutMs?: number;   // 单次超时，默认 30s
  maxRetries?: number;  // 超时/5xx 自动重试次数，默认 2 次
  preferred?: ProviderKey;
  model?: string;       // 用户指定的模型 ID（必须在 preferred 提供商目录白名单内）
  /**
   * 是否请求提供商关闭深度思考（CoT）模式。
   * - 标题/文案等纯格式化输出任务应传 true：避免 <think> 块污染 JSON 解析，且响应更快更省 token
   * - 分镜等用户可能在意创意洞察的任务可不传（默认 false，保留思考）
   * 仅对千问 (enable_thinking:false) 和豆包 (thinking:{type:'disabled'}) 生效，其他提供商忽略。
   */
  suppressThinking?: boolean;
}

export interface CallAIResult {
  ok: boolean;
  content: string;
  provider: string;     // 实际使用的提供商名
  error?: string;       // 内部诊断用（日志），不直接透给用户
  /** OpenAI 兼容的 finish_reason：'stop' 正常 / 'length' 表示输出被 max_tokens 截断 */
  finishReason?: string;
}

/**
 * 调用大模型（OpenAI 兼容 /chat/completions）
 * - 超时或 5xx 自动重试，最多 maxRetries 次（默认 2 次）
 * - 最终失败返回 ok:false，调用方统一给用户「AI服务繁忙」降级提示
 */
export async function callAI(options: CallAIOptions): Promise<CallAIResult> {
  const provider = resolveProvider(options.preferred, options.model);
  if (!provider) {
    return { ok: false, content: '', provider: '-', error: 'AI_PROVIDER_NOT_CONFIGURED' };
  }

  // 运行时诊断：把实际发给 AI 提供商的 model 打出来（ep-ID 只取前 12 位）
  const modelPreview = provider.model.startsWith('ep-') ? `${provider.model.slice(0, 12)}...` : provider.model;
  console.log(`[ai-call] provider=${provider.label} model=${modelPreview} userRequested=${options.model ?? '(auto)'}`);

  const timeoutMs = options.timeoutMs ?? provider.timeoutMs;
  const maxRetries = options.maxRetries ?? 2;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      // 沙箱/企业网络需走 HTTP(S)_PROXY 代理访问外部 API；无代理环境用全局 fetch
      const doFetch = getProxyFetch()?.fetch ?? ((u: string, i: RequestInit) => fetch(u, i));
      // 构建请求体：按提供商按需注入关闭思考的参数（仅 suppressThinking 时）
      // 千问 DashScope 兼容模式用 enable_thinking:false；豆包方舟用 thinking:{type:'disabled'}
      const body: Record<string, unknown> = {
        model: provider.model,
        messages: options.messages,
        temperature: 0.8,
        stream: false,
      };
      if (options.suppressThinking) {
        if (provider.key === 'qwen') {
          body.enable_thinking = false;
        } else if (provider.key === 'doubao') {
          body.thinking = { type: 'disabled' };
        }
      }

      const res = await doFetch(`${provider.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `${provider.authPrefix} ${provider.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (res.ok) {
        const data = (await res.json()) as {
          choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
        };
        const content = data.choices?.[0]?.message?.content || '';
        const finishReason = data.choices?.[0]?.finish_reason || '';
        if (content) {
          return { ok: true, content, provider: provider.label, finishReason };
        }
        return { ok: false, content: '', provider: provider.label, error: 'EMPTY_RESPONSE' };
      }

      // 5xx 才重试；4xx（如 key 无效）重试无意义直接失败
      if (res.status >= 500 && attempt < maxRetries) {
        continue;
      }
      return { ok: false, content: '', provider: provider.label, error: `HTTP_${res.status}` };
    } catch (e) {
      const isTimeout = e instanceof Error && e.name === 'AbortError';
      // 超时不重试：模型推理慢不是临时故障，重试只会让用户白等；
      // 仅网络错误/5xx 才重试
      if (!isTimeout && attempt < maxRetries) continue;
      const reason = isTimeout ? 'TIMEOUT' : 'NETWORK_ERROR';
      return { ok: false, content: '', provider: provider.label, error: reason };
    } finally {
      clearTimeout(timer);
    }
  }

  return { ok: false, content: '', provider: provider.label, error: 'RETRIES_EXHAUSTED' };
}

/**
 * 将 callAI 返回的内部 error 码映射为前端友好的 { code, message }。
 * 各 AI 接口统一调用，避免四处写 if-else 且文案不一致。
 */
export function describeAIError(error: string | undefined): { code: string; message: string } {
  switch (error) {
    case 'AI_PROVIDER_NOT_CONFIGURED':
      return { code: 'AI_NOT_CONFIGURED', message: 'AI 服务尚未配置 API Key，请联系管理员在后台或环境变量中配置' };
    case 'TIMEOUT':
      return { code: 'TIMEOUT', message: '请求超时，模型响应较慢，建议切换极速版或稍后重试' };
    case 'HTTP_429':
      return { code: 'RATE_LIMITED', message: '模型限流，请稍后重试' };
    case 'NETWORK_ERROR':
      return { code: 'NETWORK_ERROR', message: '网络连接失败，请检查网络后重试' };
    case 'RETRIES_EXHAUSTED':
      return { code: 'AI_BUSY', message: 'AI 服务暂不可用，请稍后重试' };
    default:
      return { code: 'AI_BUSY', message: 'AI服务繁忙，请稍后再试' };
  }
}

/** 剥离 LLM 输出中的 <think>...</think> 思考块（含自闭合 <think/> 和 OpenClaw 风格） */
function stripThinkBlocks(raw: string): string {
  // 配对块：<think> 或 <thinking> 开头，</think> 或 </thinking> 结尾（可能跨行）
  const withBlocks = raw.replace(/<\s*(?:think|thinking)\s*>[\s\S]*?<\s*\/\s*(?:think|thinking)\s*>/gi, '');
  // 自闭合：<think/> 或 <thinking />
  return withBlocks.replace(/<\s*(?:think|thinking)\s*\/?\s*>/gi, '');
}

/**
 * 判断 text 中下标 i 处的引号是否被反斜杠转义（左边连续反斜杠为奇数个 = 被转义）。
 * 正反向扫描通用：JSON 的字符串转义规则与扫描方向无关。
 */
function isEscapedQuote(text: string, i: number): boolean {
  let backslashes = 0;
  for (let j = i - 1; j >= 0 && text[j] === '\\'; j--) backslashes++;
  return backslashes % 2 === 1;
}

/**
 * 从文本末尾向前收集所有"以闭括号收尾的完整平衡 JSON 块"候选，按从后往前的顺序返回。
 * 设计要点：
 * 1. 必须从闭括号入手配对（而不是找最靠前的开括号）：对象数组 [{"a":1},{"b":2}]
 *    中最后的 { 比数组的 [ 更靠后，从开括号入手会把整个数组截成最后一个元素对象。
 * 2. 返回"所有"候选而非仅最右一个：模型可能在真实数组之后追加 [完]、[END]、[结束]
 *    等干扰块，最右块是干扰块时，继续尝试左侧候选即可拿到真实答案。
 * 3. 每个闭括号反向配对时跳过字符串字面量内的括号，避免误配。
 */
function findBalancedJSONCandidates(text: string): Array<{ start: number; end: number }> {
  // 收集所有"非字符串内"的闭括号位置
  const closes: number[] = [];
  let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (!isEscapedQuote(text, i)) inStr = !inStr;
      continue;
    }
    if (inStr) continue;
    if (ch === ']' || ch === '}') closes.push(i);
  }

  // 从最右的闭括号开始反向配对，收集平衡块
  const candidates: Array<{ start: number; end: number }> = [];
  for (let ci = closes.length - 1; ci >= 0; ci--) {
    const closeIdx = closes[ci];
    const closeCh = text[closeIdx];
    const openCh = closeCh === ']' ? '[' : '{';
    let depth = 0;
    inStr = false;
    for (let i = closeIdx; i >= 0; i--) {
      const ch = text[i];
      if (ch === '"') {
        if (!isEscapedQuote(text, i)) inStr = !inStr;
        continue;
      }
      if (inStr) continue;
      if (ch === closeCh) depth++;
      else if (ch === openCh) {
        depth--;
        if (depth === 0) {
          candidates.push({ start: i, end: closeIdx });
          break;
        }
      }
    }
  }
  return candidates;
}

/**
 * 把 LLM 输出中常见的全角标点规范化为 ASCII 半角。
 * 千问/豆包等中文模型偶尔会用全角字符作为 JSON 结构符（逗号、冒号、方括号），
 * 导致原生 JSON.parse 直接失败。在找括号配对之前先替换，能让 findLastBalancedJSON
 * 正确定位边界，也让后续 repairJSON 只需关注引号/注释/尾逗号等瑕疵。
 */
function normalizeFullwidth(text: string): string {
  return text
    // 全角圆括号 （ ）→ ( )
    .replace(/\uff08/g, '(')
    .replace(/\uff09/g, ')')
    // 全角方括号 【 】→ [ ]
    .replace(/\u3010/g, '[')
    .replace(/\u3011/g, ']')
    // 全角角括号 〈 〉→ < >
    .replace(/\u300a/g, '<')
    .replace(/\u300b/g, '>')
    // 全角冒号
    .replace(/\uff1a/g, ':')
    // 全角逗号
    .replace(/\uff0c/g, ',')
    // 全角分号
    .replace(/\uff1b/g, ';')
    // 最后把圆括号 ( ) 替换成方括号 [ ]——千问偶尔用圆括号包数组
    .replace(/\(/g, '[').replace(/\)/g, ']');
}

/**
 * 修复 LLM 生成 JSON 的常见瑕疵：
 *  - 全角/智能引号 → ASCII 双引号（覆盖"全角引号作数组分隔符"的场景）
 *  - 未转义 ASCII 引号 → 全角引号：模型在中文标题/文案里强调词语时经常漏写 \"
 *    （如 ["别再"傻干"了！…"]），导致字符串被提前闭合。中文语境修复规则：
 *    引号两侧是汉字/中文标点时视为强调引号。真正的数组分隔引号两侧是 [ , ] 空白，
 *    不受影响；已转义的 \" 左侧是反斜杠，同样不受影响。
 *  - 行注释 // ... 和块注释 /* ... *\/ 去掉
 *  - 尾逗号 ,}、,] 去掉
 * 返回修复后的字符串（可能仍不合法，调用方自行再试 JSON.parse）。
 */
function repairJSON(raw: string): string {
  return raw
    .replace(/[\u201c\u201d]/g, '"') // " " → "
    .replace(/[\u2018\u2019]/g, '"') // ' ' → "
    // 中文语境未转义引号 → 全角（顺序在"全角→ASCII"之后：刚转成 ASCII 的全角强调引号
    // 夹在汉字之间会破坏字符串，此步将其还原为全角；真正的数组分隔引号两侧是 [ , ] 空白，
    // 不匹配；已转义的 \" 左侧是反斜杠，也不匹配）
    .replace(/([\u4e00-\u9fff\uff00-\uff65\u3001-\u303f])"([\u4e00-\u9fff])/g, '$1\u201c$2')
    // 右侧扩展中文/ASCII 标点（:;!?…—、。等）：覆盖 "干货"： 这类"汉字+引号+标点"的强调引号。
    // 注意右侧绝不能包含 , ] } 空白——那是字符串真正的结尾分隔符，会被误伤。
    .replace(/([\u4e00-\u9fff])"([\u4e00-\u9fff\uff00-\uff65\u3001-\u303f:;!?…—、。，])/g, '$1\u201d$2')
    .replace(/\/\/[^\n]*/g, '') // 行注释
    .replace(/\/\*[\s\S]*?\*\//g, '') // 块注释
    .replace(/,\s*([\]}])/g, '$1'); // 尾逗号
}

/**
 * 容错提取字符串数组（仅用于纯字符串数组，如标题列表）。
 * 当响应被 max_tokens 截断（数组没有闭合 ]）或数组内混入少量脏字符时，
 * 逐个扫描元素，只接受"以引号开头、引号闭合、后跟 , 或 ]"的规整元素。
 * 遇到未闭合字符串（截断位置）或非法分隔符（脏数据）即停止/放弃，
 * 绝不从散文或思考文本里捡碎片。
 * 返回 null 表示内容不适合该提取方式。
 */
function extractPartialStringArray(text: string): string[] | null {
  const result: string[] = [];
  const start = text.indexOf('[');
  if (start < 0) return null;
  let i = start + 1;
  let sawElement = false;

  const isSpace = (ch: string) => /\s/.test(ch);
  const skipSpace = () => { while (i < text.length && isSpace(text[i])) i++; };

  while (i < text.length) {
    skipSpace();
    if (i >= text.length) break;
    const open = text[i];
    if (open === ']') return sawElement ? result : null;
    if (open !== '"' && open !== '\u201c') return null; // 元素必须以引号开头
    const close = open === '"' ? '"' : '\u201d';
    i++;

    // 读取字符串内容（处理反斜杠转义）
    let s = '';
    let closed = false;
    while (i < text.length) {
      const ch = text[i];
      if (ch === '\\') {
        if (i + 1 < text.length) { s += text[i + 1]; i += 2; } else { i++; }
        continue;
      }
      if (ch === close) { closed = true; i++; break; }
      s += ch;
      i++;
    }
    if (!closed) break; // 未闭合：截断位置，丢弃残缺元素

    sawElement = true;
    result.push(s);
    skipSpace();
    if (i >= text.length) break; // 截断在元素后：保留已收集的完整元素
    if (text[i] === ',') { i++; continue; }
    if (text[i] === ']') return result;
    return null; // 脏分隔符：放弃整个结果，避免碎片
  }
  return result.length > 0 ? result : null;
}

export interface ExtractJSONOptions {
  /** 启用容错字符串数组提取（仅当内容是字符串数组场景时传，如标题列表） */
  partialArrays?: boolean;
}

/** 从 LLM 输出文本中稳健提取 JSON 数组/对象。 */
export function extractJSON<T>(raw: string, opts?: ExtractJSONOptions): T | null {
  if (!raw) return null;

  // 第 1 步：剥掉 <think> 思考块 + 全角标点规范化
  const cleaned = normalizeFullwidth(stripThinkBlocks(raw)).trim();

  // 尝试 parse：先原样试，不行再做瑕疵修复
  const tryParse = (slice: string): T | null => {
    try { return JSON.parse(slice) as T; } catch { /* 继续 */ }
    try { return JSON.parse(repairJSON(slice)) as T; } catch { return null; }
  };

  // 第 2 步：代码块优先（```json ... ```）
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence?.[1]) {
    const r = tryParse(fence[1].trim());
    if (r !== null) return r;
  }

  // 第 3 步：平衡 JSON 块候选（从最右到最左逐个尝试）
  // 从闭括号反向配对取完整数组；模型在真实数组后追加 [完]/[END] 等干扰块时，
  // 最右候选解析失败会自动尝试左侧候选，取到真实答案。
  for (const { start, end } of findBalancedJSONCandidates(cleaned)) {
    const r = tryParse(cleaned.slice(start, end + 1));
    if (r !== null) return r;
  }

  // 第 4 步：原始策略——第一个 [/{ 到最后一个 ]/}
  const start = Math.min(...[cleaned.indexOf('['), cleaned.indexOf('{')].filter((i) => i >= 0));
  const end = Math.max(cleaned.lastIndexOf(']'), cleaned.lastIndexOf('}'));
  if (Number.isFinite(start) && end > start) {
    const r = tryParse(cleaned.slice(start, end + 1));
    if (r !== null) return r;
  }

  // 第 5 步：容错字符串数组提取（仅显式开启时）——应对响应截断/脏数组。
  // 提取前先跑 repairJSON：截断+未转义引号叠加时，修复引号后能取回完整的前缀元素
  if (opts?.partialArrays) {
    const partial = extractPartialStringArray(repairJSON(cleaned));
    if (partial !== null) return partial as unknown as T;
  }

  return null;
}
