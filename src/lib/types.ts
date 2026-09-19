// 通用类型定义

export interface CardInfo {
  code: string;
  validDays: number;
  dailyLimit: number;
  activatedAt: string | null;
  expiresAt: string | null;
  status: 'active' | 'frozen' | 'revoked' | 'expired' | 'unused';
}

export interface AuthSession {
  token: string;
  cardCode: string;
  expiresAt: string;
  issuedAt: string;
  dailyUsed: number;
  dailyLimit: number;
  cardExpiresAt: string;
  /** 次数用尽引导文案（后台可配置，空 = 不提示） */
  exhaustedTip?: string;
}

/**
 * 分镜创作方式：
 * - 'auto'   AI 自动识别文案类型（默认）
 * - 'real'   真人实拍（口播/知识分享/Vlog/探店/访谈）
 * - 'ai'     AI视频（漫剧/小说推文/虚拟画面/无真人出镜）
 * - 'hybrid' 混合创作（真人口播 + AI画面/B-roll）
 */
export type CreationMode = 'auto' | 'real' | 'ai' | 'hybrid';

export interface StoryboardShot {
  shotNumber: number;
  sceneDescription: string;
  dialogue: string;
  duration: string;
  cameraMove: string;
  /** 混合创作模式下标注镜头类型：real = 真人实拍，ai = AI生成画面/B-roll */
  shotType?: 'real' | 'ai';
  /** AI视频模式：场景编号，同一连续场景的镜头共用同一编号，场景切换（换地点/换时间）时递增；旧数据无此字段 */
  sceneId?: number;
}

export interface StoryboardResult {
  id: string;
  type: 'storyboard';
  title: string;
  createdAt: string;
  inputText: string;
  /** 实际使用的创作方式（旧历史记录可能没有该字段） */
  creationMode?: Exclude<CreationMode, 'auto'>;
  shots: StoryboardShot[];
}

export interface TitleResult {
  id: string;
  type: 'titles';
  title: string;
  createdAt: string;
  inputText: string;
  titles: string[];
}

export type HistoryItem = StoryboardResult | TitleResult;

export type AIModelProvider =
  | 'qwen'         // 通义千问
  | 'zhipu'        // 智谱AI
  | 'deepseek'     // Deepseek
  | 'hunyuan'      // 混元（腾讯）
  | 'doubao'       // 豆包（字节）
  | 'siliconflow'; // 硅基流动

export interface SystemConfig {
  defaultProvider: AIModelProvider;
  dailyLimit: number;
}
