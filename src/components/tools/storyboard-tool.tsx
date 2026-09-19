'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCardAuth } from '@/lib/card-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Clapperboard,
  Copy,
  Download,
  ChevronDown,
  Loader2,
  Clock,
  Camera,
  MessageSquare,
  Sparkles,
  RefreshCw,
  CheckCircle2,
  Film,
  PersonStanding,
} from 'lucide-react';
import { toast } from 'sonner';
import { ModelSelector, type ModelSelection, type ModelSuggestion } from '@/components/model-selector';
import { GeneratingProgress } from '@/components/generating-progress';
import { FeedbackDialog, type FeedbackContext } from '@/components/feedback-dialog';
import { setToolPrefill, consumeToolPrefill } from '@/lib/tool-prefill';
import type { StoryboardShot, StoryboardResult, CreationMode } from '@/lib/types';
import {
  VIDEO_GEN_MODELS,
  DEFAULT_VIDEO_MODEL_ID,
  getVideoModel,
  buildVideoSegments,
  segmentToText,
  shotToText,
  type VideoSegment,
} from '@/lib/video-segments';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';

// 测试用模拟数据
const MOCK_SHOTS: StoryboardShot[] = [
  { shotNumber: 1, sceneDescription: '清晨阳光透过窗帘，主角缓缓睁开眼睛，微笑看向窗外', dialogue: '', duration: '3秒', cameraMove: '固定机位，柔光' },
  { shotNumber: 2, sceneDescription: '主角走进厨房，拿起手冲咖啡壶，专注地注水', dialogue: '旁白：「美好的一天，从一杯手冲开始」', duration: '5秒', cameraMove: '推镜，中景→特写' },
  { shotNumber: 3, sceneDescription: '咖啡液缓缓滴入分享壶，琥珀色液体冒着热气', dialogue: '（白噪音：咖啡滴答声）', duration: '4秒', cameraMove: '微距俯拍，慢动作' },
  { shotNumber: 4, sceneDescription: '主角端着咖啡走到阳台，迎着阳光深呼吸', dialogue: '旁白：「生活需要仪式感，哪怕只有5分钟」', duration: '6秒', cameraMove: '环绕运镜' },
  { shotNumber: 5, sceneDescription: '咖啡杯特写，配字幕总结，画面渐暗', dialogue: '字幕：#生活方式 #手冲咖啡 #治愈系', duration: '3秒', cameraMove: '固定，淡出' },
];

// 创作方式选项（默认 auto：AI 根据文案自动识别，普通用户无需理解概念差异）
const CREATION_MODES: { value: CreationMode; label: string; desc: string }[] = [
  { value: 'auto', label: '✨ 自动', desc: 'AI 自动识别文案类型' },
  { value: 'real', label: '🧑 真人实拍', desc: '口播 / 知识分享 / Vlog，手机可拍' },
  { value: 'ai', label: '🤖 AI视频', desc: '漫剧 / 小说推文 / 虚拟画面' },
  { value: 'hybrid', label: '🔀 混合创作', desc: '真人口播 + AI画面 / B-roll' },
];

const MODE_NAME: Record<Exclude<CreationMode, 'auto'>, string> = {
  real: '真人实拍', ai: 'AI视频', hybrid: '混合创作',
};

// 创作模式 → 推荐大模型厂商（实测匹配度）：AI视频/混合 → 豆包（分镜更易被 Seedance 等视频模型理解）；真人实拍 → 千问（口播分镜质量佳）；auto 最终模式未知，不建议
const MODEL_SUGGESTION: Partial<Record<Exclude<CreationMode, 'auto'>, ModelSuggestion>> = {
  ai: { providerKey: 'doubao', reason: 'AI视频模式下，豆包系列模型生成的分镜更易被 Seedance 等视频模型理解' },
  hybrid: { providerKey: 'doubao', reason: '混合创作模式下，豆包系列模型的 AI 画面提示词质量更佳' },
  real: { providerKey: 'qwen', modelId: 'qwen-turbo', reason: '真人实拍模式下，千问系列模型的口播分镜质量更佳' },
};

export function StoryboardTool() {
  const { session, refreshUsage, logout } = useCardAuth();
  const router = useRouter();
  const [inputText, setInputText] = useState('');
  const [extra, setExtra] = useState('');
  const [extraOpen, setExtraOpen] = useState(false);
  const [shotCount, setShotCount] = useState<number | 'auto'>('auto'); // 分镜数量：'auto' = AI 智能判断，或 3-15 整数
  const [creationMode, setCreationMode] = useState<CreationMode>('auto'); // 创作方式：默认 AI 自动识别
  const [customMode, setCustomMode] = useState(false);
  const [customInput, setCustomInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<StoryboardShot[] | null>(null);
  const [resultMeta, setResultMeta] = useState<{ id: string; title: string; creationMode?: Exclude<CreationMode, 'auto'> } | null>(null);
  const [copied, setCopied] = useState(false);
  const [model, setModel] = useState<ModelSelection>({ cost: 1 });
  // AI视频生成段：目标视频模型（时长上限）选择 + 段复制反馈
  const [videoModelId, setVideoModelId] = useState(DEFAULT_VIDEO_MODEL_ID);
  const [copiedSeg, setCopiedSeg] = useState<number | null>(null);
  // 错误反馈：生成失败时 toast 上带"反馈"按钮，自动附带失败上下文
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackContext, setFeedbackContext] = useState<FeedbackContext | undefined>();

  const openErrorFeedback = (error: string) => {
    setFeedbackContext({ tool: '分镜脚本', model: model.model || model.provider, error: error.slice(0, 300) });
    setFeedbackOpen(true);
  };

  // 跨工具联动：其他页面点"拿去生成分镜"时回填输入框
  useEffect(() => {
    const prefill = consumeToolPrefill('storyboard');
    if (prefill) setInputText(prefill);
  }, []);

  // 自定义输入的合法值（3-15 整数）
  const customParsed = parseInt(customInput, 10);
  const customValid = Number.isFinite(customParsed) && customParsed >= 3 && customParsed <= 15;
  const effectiveCount = customMode ? (customValid ? customParsed : shotCount) : shotCount;

  const applyPreset = (n: number | 'auto') => {
    setShotCount(n);
    setCustomMode(false);
  };

  const applyCustom = () => {
    if (customValid) {
      setShotCount(customParsed);
      setCustomMode(false);
      setCustomInput('');
    }
  };

  const handleGenerate = async (useMock = false) => {
    if (!inputText.trim()) {
      toast.error('请输入视频文案或故事文本');
      return;
    }
    if (session && session.dailyUsed + model.cost > session.dailyLimit) {
      const base = session.dailyUsed >= session.dailyLimit ? '今日次数已用完，请明天再来哦' : `剩余次数不足（本次需消耗${model.cost}次），请更换低档位模型`;
      toast.error(session.exhaustedTip ? `${base}\n${session.exhaustedTip}` : base, { duration: session.exhaustedTip ? 6000 : 4000 });
      return;
    }
    setLoading(true);
    try {
      if (useMock) {
        // 演示模式：使用模拟数据
        await new Promise((r) => setTimeout(r, 1200));
        setResult(MOCK_SHOTS);
        setResultMeta({ id: 'demo-' + Date.now(), title: '演示分镜脚本（非真实AI生成）', creationMode: 'ai' });
        toast.success('演示分镜已生成（预览模式）');
      } else {
        const res = await fetch('/api/ai/storyboard', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session?.token}`,
          },
          body: JSON.stringify({ text: inputText, count: effectiveCount, provider: model.provider, model: model.model, extra: extra.trim() || undefined, mode: creationMode }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          if (data.code === 'SESSION_INVALID') {
            // 清除本地失效 session，让首页重新显示激活表单
            logout();
            toast.error('登录状态已失效，请重新验证卡密');
            return;
          }
          // AI 失败降级：展示基础模板分镜（本次不消耗次数）
          if (data.fallback?.shots) {
            setResult(data.fallback.shots as StoryboardShot[]);
            setResultMeta({ id: 'fallback', title: '基础模板分镜（AI繁忙降级，本次不扣次数）' });
            toast.warning(data.error || 'AI服务繁忙，已展示基础模板（本次不消耗次数），请稍后重试');
            return;
          }
          // 次数用尽：附带后台配置的引导文案
          if (data.code === 'DAILY_LIMIT' && data.tip) {
            toast.error(`${data.error}\n${data.tip}`, { duration: 6000 });
            return;
          }
          toast.error(data.error || '生成失败，请稍后再试', {
            duration: 6000,
            action: { label: '反馈', onClick: () => openErrorFeedback(data.error || '生成失败') },
          });
          return;
        }
        setResult(data.shots as StoryboardShot[]);
        setResultMeta({ id: data.id, title: data.title || '分镜脚本', creationMode: data.creationMode });
        await refreshUsage();
        // auto 模式下告知用户识别结果，让"AI 自动判断"可感知
        const modeNote = data.autoDetected && data.creationMode
          ? `已识别为「${MODE_NAME[data.creationMode as Exclude<CreationMode, 'auto'>]}」文案`
          : undefined;
        toast.success(modeNote ? `分镜生成成功（${modeNote}）` : '分镜脚本生成成功！');
      }
    } catch (e) {
      console.error(e);
      toast.error('网络错误，请稍后再试', {
        duration: 6000,
        action: { label: '反馈', onClick: () => openErrorFeedback('网络错误') },
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    if (!result) return;
    const text = result.map(shotToText).join('\n\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success('已复制到剪贴板');
  };

  const handleExportJSON = () => {
    if (!result || !resultMeta) return;
    const data: StoryboardResult = {
      id: resultMeta.id,
      type: 'storyboard',
      title: resultMeta.title,
      createdAt: new Date().toISOString(),
      inputText,
      ...(resultMeta.creationMode ? { creationMode: resultMeta.creationMode } : {}),
      shots: result,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `分镜脚本_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const totalDuration = result
    ? result.reduce((acc, s) => {
        const m = s.duration.match(/(\d+)/);
        return acc + (m ? parseInt(m[1]) : 0);
      }, 0)
    : 0;

  // AI视频生成段：仅 AI视频模式结果展示（real/hybrid 镜头不进 AI 视频工具）
  const activeVideoModel = getVideoModel(videoModelId);
  const videoSegments = useMemo<VideoSegment[]>(
    () =>
      result && resultMeta?.creationMode === 'ai'
        ? buildVideoSegments(result, activeVideoModel.maxDuration)
        : [],
    [result, resultMeta?.creationMode, activeVideoModel.maxDuration],
  );

  const handleCopySegment = (seg: VideoSegment) => {
    navigator.clipboard.writeText(segmentToText(seg));
    setCopiedSeg(seg.index);
    setTimeout(() => setCopiedSeg(null), 1500);
    toast.success(`已复制生成段 ${seg.index}（含镜头 ${seg.shots[0].shotNumber}-${seg.shots[seg.shots.length - 1].shotNumber}）`);
  };

  // 工作流联动：AI 视频结果 → 角色三视图（复用同一故事，人物锚点同源）
  const handleToCharviews = () => {
    setToolPrefill('charviews', inputText);
    router.push('/studio?tool=charviews');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Badge variant="secondary">今日 {session?.dailyUsed}/{session?.dailyLimit}</Badge>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-2">
            <Clapperboard className="h-7 w-7 text-primary" />
            文本转分镜脚本
          </h1>
          <p className="mt-1.5 text-muted-foreground text-sm sm:text-base">
            粘贴你的视频文案或故事，AI 一键生成专业短视频分镜表
          </p>
        </div>
      </div>

      <div className="grid lg:grid-cols-5 gap-6">
        {/* 输入区 */}
        <Card className="lg:col-span-2 border-border/60 h-fit">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-primary" />
              输入视频文案
            </CardTitle>
            <CardDescription>建议 100-2000 字，描述越清楚分镜越精准</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
              <ModelSelector
                value={model}
                onChange={setModel}
                suggestion={creationMode === 'auto' ? undefined : MODEL_SUGGESTION[creationMode]}
              />
            </div>
            <Textarea
              placeholder="例如：&#10;&#10;周末早晨，我决定给自己做一杯手冲咖啡。窗外阳光正好，咖啡豆的香气弥漫整个房间。慢下来，感受生活中的小确幸..."
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              className="min-h-[300px] resize-y text-sm leading-relaxed"
            />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{inputText.length} 字</span>
              <span>建议 100-2000 字</span>
            </div>

            {/* 高级要求（可选）：默认收起，不干扰主流程 */}
            <div>
              <button
                type="button"
                onClick={() => setExtraOpen((v) => !v)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${extraOpen ? 'rotate-180' : ''}`} />
                高级要求（可选）
              </button>
              {extraOpen && (
                <div className="mt-2">
                  <Input
                    placeholder="如：画面偏日系清新风 / 每个镜头都有人物出镜 / 台词口语化"
                    value={extra}
                    maxLength={100}
                    onChange={(e) => setExtra(e.target.value)}
                    className="text-sm"
                  />
                  <div className="mt-1 text-right text-xs text-muted-foreground">
                    <span className={extra.length > 90 ? 'text-destructive font-medium' : ''}>{extra.length}/100</span>
                  </div>
                </div>
              )}
            </div>

            {/* 创作方式选择：默认 AI 自动识别文案类型，专业用户可手动指定 */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">创作方式</label>
                <span className="text-xs text-primary font-medium truncate ml-2">
                  {CREATION_MODES.find((m) => m.value === creationMode)?.desc}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {CREATION_MODES.map((m) => (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => setCreationMode(m.value)}
                    title={m.desc}
                    className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                      creationMode === m.value
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'border border-border text-muted-foreground hover:border-primary/40 hover:text-primary'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 分镜数量选择：自动（AI 智能判断）+ 快捷档位 + 自定义 */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">分镜数量</label>
                <span className="text-xs text-primary font-medium">
                  {shotCount === 'auto' ? 'AI 将根据内容智能判断条数' : `将生成 ${effectiveCount} 条`}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => applyPreset('auto')}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                    !customMode && shotCount === 'auto'
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'border border-border text-muted-foreground hover:border-primary/40 hover:text-primary'
                  }`}
                >
                  自动
                </button>
                {[3, 5, 10, 15].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => applyPreset(n)}
                    className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                      !customMode && shotCount === n
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'border border-border text-muted-foreground hover:border-primary/40 hover:text-primary'
                    }`}
                  >
                    {n} 条
                  </button>
                ))}
                {!customMode ? (
                  <button
                    type="button"
                    onClick={() => setCustomMode(true)}
                    className="rounded-lg px-3 py-1.5 text-sm text-muted-foreground border border-border hover:border-primary/40 hover:text-primary transition-colors"
                  >
                    自定义
                  </button>
                ) : (
                  <span className="flex items-center gap-1.5">
                    <input
                      type="number"
                      min={3}
                      max={15}
                      value={customInput}
                      onChange={(e) => setCustomInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && applyCustom()}
                      placeholder="3-15"
                      className="w-20 h-9 rounded-lg border border-border px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={applyCustom}
                      disabled={!customValid}
                      className="h-9"
                    >
                      确定
                    </Button>
                    <button
                      type="button"
                      onClick={() => { setCustomMode(false); setCustomInput(''); }}
                      className="text-xs text-muted-foreground hover:text-foreground px-1"
                    >
                      取消
                    </button>
                  </span>
                )}
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <Button
                onClick={() => handleGenerate(false)}
                disabled={loading || !inputText.trim()}
                className="flex-1 gap-2 h-11"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    AI 生成中...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    生成分镜{model.cost > 1 ? `（耗${model.cost}次）` : ''}
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                onClick={() => handleGenerate(true)}
                disabled={loading}
                className="gap-2"
                title="无需卡密，查看演示效果"
              >
                <RefreshCw className="h-4 w-4" />
                演示预览
              </Button>
            </div>
            <div className="rounded-lg bg-slate-50 border border-border/60 p-3 text-xs text-muted-foreground leading-relaxed">
              💡 小技巧：文案中包含人物、场景、情绪描述时，生成效果最佳。每条分镜将包含镜头序号、画面描述、台词旁白、预估时长、运镜建议。
            </div>
          </CardContent>
        </Card>

        {/* 输出区 */}
        <Card className="lg:col-span-3 border-border/60">
          <CardHeader className="flex-row items-center justify-between space-y-0 gap-4 flex-wrap">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <Camera className="h-5 w-5 text-fuchsia-500" />
                分镜脚本
              </CardTitle>
              <CardDescription>
                {result ? (
                  <span className="flex items-center gap-2">
                    共 {result.length} 个镜头
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      预估总时长约 {totalDuration} 秒
                    </span>
                  </span>
                ) : (
                  '等待输入生成...'
                )}
              </CardDescription>
            </div>
            {result && (
              <div className="flex items-center gap-2">
                {resultMeta?.creationMode === 'ai' && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleToCharviews}
                    className="gap-1.5 h-9 border-amber-300 text-amber-700 hover:bg-amber-50 hover:text-amber-800"
                    title="用当前故事生成角色三视图提示词，生图做角色参考图，人物一致性更稳"
                  >
                    <PersonStanding className="h-4 w-4" />
                    角色三视图
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleGenerate(false)}
                  disabled={loading || !inputText.trim()}
                  className="gap-1.5 h-9"
                  title="用当前文案和模型重新生成"
                >
                  <RefreshCw className="h-4 w-4" />
                  重新生成
                </Button>
                <Button size="sm" variant="outline" onClick={handleCopy} className="gap-1.5 h-9">
                  {copied ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                  {copied ? '已复制' : '复制'}
                </Button>
                <Button size="sm" variant="outline" onClick={handleExportJSON} className="gap-1.5 h-9">
                  <Download className="h-4 w-4" />
                  导出
                </Button>
              </div>
            )}
          </CardHeader>
          <CardContent>
            {!result && !loading && (
              <div className="py-20 text-center">
                <div className="mx-auto h-16 w-16 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mb-4">
                  <Clapperboard className="h-8 w-8" />
                </div>
                <p className="text-muted-foreground">在左侧输入文案，点击「生成分镜」即可</p>
                <p className="text-xs text-muted-foreground/80 mt-2">也可以先点「演示预览」看看效果 ✨</p>
              </div>
            )}

            {loading && (
              <GeneratingProgress
                stages={['正在分析文案结构…', '正在拆解分镜画面…', '正在编排台词与运镜…', '好内容值得等待，即将完成…']}
              />
            )}

            {result && !loading && (
              <>
                {resultMeta?.creationMode === 'ai' && (
                  <div className="mb-4 rounded-xl border border-violet-200 bg-violet-50/40 p-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm font-semibold text-violet-800 flex items-center gap-1.5">
                        <Film className="h-4 w-4" />
                        AI视频生成段
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs text-muted-foreground">单次生成上限</span>
                        {VIDEO_GEN_MODELS.map((m) => (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => setVideoModelId(m.id)}
                            className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                              videoModelId === m.id
                                ? 'bg-violet-600 text-white shadow-sm'
                                : 'border border-violet-200 bg-white text-violet-700 hover:border-violet-400'
                            }`}
                          >
                            {m.label} · {m.maxDuration}秒
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      {videoSegments.map((seg) => {
                        const first = seg.shots[0]?.shotNumber ?? 0;
                        const last = seg.shots[seg.shots.length - 1]?.shotNumber ?? 0;
                        const range = first === last ? `镜头 ${first}` : `镜头 ${first}-${last}`;
                        return (
                          <div
                            key={seg.index}
                            className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-white px-3 py-2 ${
                              seg.exceeds || seg.hasUnknown ? 'border-amber-300' : 'border-violet-100'
                            }`}
                          >
                            <div className="text-sm min-w-0">
                              <span className="font-medium text-violet-800">生成段 {seg.index}</span>
                              <span className="text-muted-foreground mx-1.5">·</span>
                              <span>{range}</span>
                              {seg.sceneIds.length > 0 && (
                                <>
                                  <span className="text-muted-foreground mx-1.5">·</span>
                                  <span
                                    className="text-violet-600"
                                    title={seg.sceneContinued ? '同一场景因时长上限拆分，段首镜头已包含必要前置状态' : '段边界与场景切换对齐，段内画面天然连续'}
                                  >
                                    场景 {seg.sceneIds.join('、')}{seg.sceneContinued ? ' · 续' : ''}
                                  </span>
                                </>
                              )}
                              <span className="text-muted-foreground mx-1.5">·</span>
                              <span className={seg.totalSeconds === null ? 'text-amber-600' : undefined}>
                                {seg.totalSeconds === null ? '时长未知，建议单独生成' : `预计 ${seg.totalSeconds} 秒`}
                              </span>
                              {seg.exceeds && (
                                <span className="block text-xs text-amber-600 mt-0.5">
                                  该镜头时长已超出 {activeVideoModel.label} 的 {activeVideoModel.maxDuration} 秒上限，建议精简画面描述或拆分镜头
                                </span>
                              )}
                            </div>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleCopySegment(seg)}
                              className="gap-1.5 h-8 shrink-0"
                            >
                              {copiedSeg === seg.index ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                              {copiedSeg === seg.index ? '已复制' : '复制本段'}
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      每个生成段的总时长已控制在所选模型的单次生成上限内，且优先在场景切换处分段（标「续」的段为同一场景因时长上限的延续，段首已含前置状态）；点击「复制本段」后可直接粘贴到视频模型连续生成，若某段效果不理想，可改为逐镜头复制。
                    </p>
                  </div>
                )}
                <Tabs defaultValue="cards">
                <TabsList className="mb-4">
                  <TabsTrigger value="cards">卡片视图</TabsTrigger>
                  <TabsTrigger value="table">表格视图</TabsTrigger>
                  <TabsTrigger value="json">JSON</TabsTrigger>
                </TabsList>

                <TabsContent value="cards" className="space-y-3 mt-0">
                  {result.map((shot) => (
                    <div
                      key={shot.shotNumber}
                      className="rounded-xl border border-border/60 bg-gradient-to-br from-white to-slate-50 p-4 hover:shadow-md transition-shadow"
                    >
                      <div className="flex flex-wrap items-start gap-3 mb-3">
                        <Badge variant="secondary" className="bg-primary text-primary-foreground border-primary/20">
                          镜头 {String(shot.shotNumber).padStart(2, '0')}
                        </Badge>
                        {shot.sceneId !== undefined && (
                          <Badge variant="outline" className="text-sky-700 border-sky-200 bg-sky-50/60">
                            场景 {shot.sceneId}
                          </Badge>
                        )}
                        {shot.shotType && (
                          <Badge
                            variant="outline"
                            className={
                              shot.shotType === 'real'
                                ? 'text-emerald-700 border-emerald-200 bg-emerald-50/60'
                                : 'text-violet-700 border-violet-200 bg-violet-50/60'
                            }
                          >
                            {shot.shotType === 'real' ? '🧑 真人实拍' : '🤖 AI画面'}
                          </Badge>
                        )}
                        <Badge variant="outline" className="gap-1 whitespace-normal shrink">
                          <Clock className="h-3 w-3 shrink-0" /> {shot.duration}
                        </Badge>
                        <Badge variant="outline" className="gap-1 text-fuchsia-700 border-fuchsia-200 bg-fuchsia-50/50 whitespace-normal shrink">
                          <Camera className="h-3 w-3 shrink-0" /> {shot.cameraMove}
                        </Badge>
                      </div>
                      <div className="space-y-2 text-sm">
                        <div>
                          <span className="font-semibold text-primary text-xs">画面 · </span>
                          <span className="leading-relaxed break-words">{shot.sceneDescription}</span>
                        </div>
                        {shot.dialogue && (
                          <div className="rounded-lg bg-slate-50 border-l-2 border-indigo-400 px-3 py-2 text-slate-700">
                            <span className="font-semibold text-indigo-600 text-xs">台词/旁白 · </span>
                            <span className="break-words">{shot.dialogue}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </TabsContent>

                <TabsContent value="table" className="mt-0">
                  {/* 移动端：卡片式布局（避免小屏横向滚动） */}
                  <div className="sm:hidden space-y-3">
                    {result.map((shot) => (
                      <div key={shot.shotNumber} className="rounded-xl border border-border/60 bg-muted/20 p-3.5 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="font-mono font-bold text-primary">
                            镜头 {shot.shotNumber}
                            {shot.shotType && (
                              <span className={`ml-1.5 font-sans text-xs rounded-full px-2 py-0.5 ${shot.shotType === 'real' ? 'bg-emerald-100 text-emerald-700' : 'bg-violet-100 text-violet-700'}`}>
                                {shot.shotType === 'real' ? '真人' : 'AI'}
                              </span>
                            )}
                          </span>
                          <span className="text-xs rounded-full bg-primary/10 text-primary px-2 py-0.5">{shot.duration}</span>
                        </div>
                        <p className="text-sm leading-relaxed">{shot.sceneDescription}</p>
                        {shot.dialogue && (
                          <p className="text-sm text-muted-foreground border-l-2 border-border pl-2.5">{shot.dialogue}</p>
                        )}
                        <p className="text-xs text-muted-foreground">运镜：{shot.cameraMove}</p>
                      </div>
                    ))}
                  </div>
                  {/* 桌面端：表格布局 */}
                  <div className="hidden sm:block rounded-xl border border-border/60 overflow-x-auto">
                    <Table className="min-w-[560px]">
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-16">镜头</TableHead>
                          {result.some((s) => s.shotType) && <TableHead className="w-24">类型</TableHead>}
                          <TableHead>画面描述</TableHead>
                          <TableHead>台词/旁白</TableHead>
                          <TableHead className="w-20">时长</TableHead>
                          <TableHead className="w-32">运镜</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {result.map((shot) => (
                          <TableRow key={shot.shotNumber}>
                            <TableCell className="font-mono font-bold text-primary">{shot.shotNumber}</TableCell>
                            {result.some((s) => s.shotType) && (
                              <TableCell className="whitespace-nowrap">
                                {shot.shotType ? (
                                  <span className={`text-xs rounded-full px-2 py-0.5 ${shot.shotType === 'real' ? 'bg-emerald-100 text-emerald-700' : 'bg-violet-100 text-violet-700'}`}>
                                    {shot.shotType === 'real' ? '真人实拍' : 'AI画面'}
                                  </span>
                                ) : (
                                  '—'
                                )}
                              </TableCell>
                            )}
                            <TableCell className="text-sm leading-relaxed max-w-sm">{shot.sceneDescription}</TableCell>
                            <TableCell className="text-sm max-w-xs text-muted-foreground">{shot.dialogue || '—'}</TableCell>
                            <TableCell className="whitespace-nowrap text-sm">{shot.duration}</TableCell>
                            <TableCell className="text-sm whitespace-nowrap">{shot.cameraMove}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </TabsContent>

                <TabsContent value="json" className="mt-0">
                  <pre className="rounded-xl bg-slate-900 text-slate-100 text-xs p-4 overflow-auto max-h-[600px] leading-relaxed font-mono">
{JSON.stringify(result, null, 2)}
                  </pre>
                </TabsContent>
              </Tabs>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 错误反馈弹窗（生成失败时从 toast 按钮唤起） */}
      <FeedbackDialog open={feedbackOpen} onOpenChange={setFeedbackOpen} presetType="bug" presetContext={feedbackContext} />
    </div>
  );
}
