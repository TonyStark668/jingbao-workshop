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
  PenLine,
  Copy,
  CheckCircle2,
  ChevronDown,
  Loader2,
  RefreshCw,
  FileText,
  Clapperboard,
  Sparkles,
  ArrowRight,
} from 'lucide-react';
import { toast } from 'sonner';
import { ModelSelector, type ModelSelection } from '@/components/model-selector';
import { GeneratingProgress } from '@/components/generating-progress';
import { FeedbackDialog, type FeedbackContext } from '@/components/feedback-dialog';
import { setToolPrefill, consumeToolPrefill } from '@/lib/tool-prefill';
import type { PolishMode } from '@/lib/types';

// 三模式：润色（不改剧情）/ 扩写（不偏主线）/ 缩写（保留四要素）
const MODES: { value: PolishMode; label: string; desc: string }[] = [
  { value: 'polish', label: '✨ 润色', desc: '提升表达，不改剧情' },
  { value: 'expand', label: '📖 扩写', desc: '补充细节，不偏主线' },
  { value: 'condense', label: '✂️ 缩写', desc: '压缩篇幅，保留梗概' },
];

const MODE_NAME: Record<PolishMode, string> = { polish: '润色', expand: '扩写', condense: '缩写' };

// 篇幅选项（按模式切换）：字数用范围控制，不追求精确
const LENGTH_PRESETS: Record<PolishMode, { value: string; label: string }[]> = {
  polish: [{ value: 'same', label: '与原文相当' }],
  expand: [
    { value: 'x15', label: '约1.5倍' },
    { value: 'x2', label: '约2倍' },
    { value: 'x3', label: '约3倍' },
  ],
  condense: [
    { value: 'half', label: '约一半' },
    { value: 'third', label: '约三分之一' },
    { value: '60s', label: '60秒口播' },
    { value: '30s', label: '30秒口播' },
  ],
};

const DEFAULT_PRESET: Record<PolishMode, string> = { polish: 'same', expand: 'x2', condense: 'half' };

// 高级要求占位符按模式特化：模式语义不同，示例也该不同
const EXTRA_PLACEHOLDER: Record<PolishMode, string> = {
  polish: '如：口语化风格 / 重点增强画面感 / 保留原台词',
  expand: '如：补充人物心理 / 增加环境描写 / 加对话互动',
  condense: '如：保留主角名字 / 保留关键情节 / 压缩到口播节奏',
};

/** 按篇幅选项 + 原文长度计算目标字数范围（范围控制，锚点：口播约4字/秒） */
function computeLengthHint(preset: string, inputLen: number): string {
  const round10 = (n: number) => Math.max(20, Math.round(n / 10) * 10);
  switch (preset) {
    case 'same':
      return `${round10(inputLen * 0.85)}-${round10(inputLen * 1.15)}字`;
    case 'x15':
      return `${round10(inputLen * 1.4)}-${round10(inputLen * 1.6)}字`;
    case 'x2':
      return `${round10(inputLen * 1.8)}-${round10(inputLen * 2.2)}字`;
    case 'x3':
      return `${round10(inputLen * 2.7)}-${round10(inputLen * 3.3)}字`;
    case 'half':
      return `${round10(inputLen * 0.45)}-${round10(inputLen * 0.55)}字`;
    case 'third':
      return `${round10(inputLen * 0.3)}-${round10(inputLen * 0.38)}字`;
    case '60s':
      return '240-280字（约60秒口播）';
    case '30s':
      return '120-150字（约30秒口播）';
    default:
      return '';
  }
}

const PROGRESS_STAGES: Record<PolishMode, string[]> = {
  polish: ['正在通读你的故事…', '正在修正表达…', '正在增强画面感…', '好内容值得等待，即将完成…'],
  expand: ['正在理解故事主线…', '正在构思补充细节…', '正在展开关键情节…', '好内容值得等待，即将完成…'],
  condense: ['正在梳理故事脉络…', '正在提取核心要素…', '正在压缩冗余表达…', '好内容值得等待，即将完成…'],
};

// 演示预览（非真实AI生成）
const MOCK_POLISH =
  '傍晚的校园走廊里，17岁的黑发少年小杰背着书包慢慢走着，夕阳把他的影子拉得很长。突然，一只银白色的狐狸从教室后门窜出，停在他面前，琥珀色的眼睛一眨不眨地盯着他。小杰愣在原地，书包带从肩上滑落也没察觉。狐狸轻轻叫了一声，转身朝楼梯口跑去，跑两步又回头看他。小杰深吸一口气，捡起书包跟了上去。';

export function PolishTool() {
  const { session, refreshUsage, logout } = useCardAuth();
  const router = useRouter();
  const [inputText, setInputText] = useState('');
  const [mode, setMode] = useState<PolishMode>('polish');
  const [lengthPreset, setLengthPreset] = useState(DEFAULT_PRESET.polish);
  const [extra, setExtra] = useState('');
  const [extraOpen, setExtraOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ text: string; mode: PolishMode; inputLen: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const [model, setModel] = useState<ModelSelection>({ cost: 1 });
  // 错误反馈：生成失败时 toast 上带"反馈"按钮，自动附带失败上下文
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackContext, setFeedbackContext] = useState<FeedbackContext | undefined>();

  // 跨工具联动：其他页面点"拿去润色"时回填输入框
  useEffect(() => {
    const prefill = consumeToolPrefill('polish');
    if (prefill) setInputText(prefill);
  }, []);

  const openErrorFeedback = (error: string) => {
    setFeedbackContext({ tool: '文案润色', model: model.model || model.provider, error: error.slice(0, 300) });
    setFeedbackOpen(true);
  };

  const switchMode = (m: PolishMode) => {
    setMode(m);
    setLengthPreset(DEFAULT_PRESET[m]);
  };

  // 目标字数范围随篇幅选项与原文长度实时计算
  const lengthHint = useMemo(
    () => (inputText.trim().length >= 10 ? computeLengthHint(lengthPreset, inputText.trim().length) : ''),
    [lengthPreset, inputText],
  );

  const handleGenerate = async (useMock = false) => {
    const text = inputText.trim();
    if (!text) {
      toast.error('请输入你的故事文案');
      return;
    }
    if (text.length < 10) {
      toast.error('文案太短啦，至少需要 10 个字');
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
        await new Promise((r) => setTimeout(r, 1000));
        setResult({ text: MOCK_POLISH, mode, inputLen: text.length });
        toast.success('演示文案已生成（预览模式）');
      } else {
        const res = await fetch('/api/ai/polish', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session?.token}`,
          },
          body: JSON.stringify({
            text,
            mode,
            lengthHint: lengthHint || undefined,
            provider: model.provider,
            model: model.model,
            extra: extra.trim() || undefined,
          }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          if (data.code === 'SESSION_INVALID') {
            // 清除本地失效 session，让首页重新显示激活表单
            logout();
            toast.error('登录状态已失效，请重新验证卡密');
            return;
          }
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
        setResult({ text: data.text as string, mode: data.mode as PolishMode, inputLen: text.length });
        await refreshUsage();
        toast.success(`文案${MODE_NAME[data.mode as PolishMode] || ''}完成！`);
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
    navigator.clipboard.writeText(result.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success('已复制到剪贴板');
  };

  // 联动：润色结果拿去生成分镜 / 爆款标题
  const handleToStoryboard = () => {
    if (!result) return;
    setToolPrefill('storyboard', result.text);
    router.push('/studio?tool=storyboard');
  };
  const handleToTitles = () => {
    if (!result) return;
    setToolPrefill('titles', result.text);
    router.push('/studio?tool=titles');
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Badge variant="secondary">今日 {session?.dailyUsed}/{session?.dailyLimit}</Badge>
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-2">
          <PenLine className="h-7 w-7 text-emerald-500" />
          文案润色 · 扩写 · 缩写
        </h1>
        <p className="mt-1.5 text-muted-foreground text-sm sm:text-base">
          自己写的故事不知道行不行？润色增强画面感、扩写补充细节、缩写提炼精华，产出即可直接生成分镜
        </p>
      </div>

      <div className="grid lg:grid-cols-5 gap-6">
        {/* 输入区 */}
        <Card className="lg:col-span-2 border-border/60 h-fit">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <FileText className="h-5 w-5 text-emerald-500" />
              输入你的故事文案
            </CardTitle>
            <CardDescription>建议 50-3000 字，写得粗糙也没关系，AI 帮你打磨</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* 模式选择：三模式行为边界不同 */}
            <div className="space-y-2">
              <span className="text-xs text-muted-foreground">处理模式</span>
              <div className="grid grid-cols-3 gap-1.5">
                {MODES.map((m) => {
                  const active = mode === m.value;
                  return (
                    <button
                      key={m.value}
                      type="button"
                      onClick={() => switchMode(m.value)}
                      className={`rounded-xl px-2.5 py-2.5 text-left transition-all border ${
                        active
                          ? 'border-emerald-500 bg-emerald-50 shadow-sm'
                          : 'border-border/60 bg-white hover:border-emerald-300'
                      }`}
                    >
                      <span className={`block text-sm font-medium ${active ? 'text-emerald-700' : ''}`}>{m.label}</span>
                      <span className="block text-xs text-muted-foreground mt-0.5">{m.desc}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 篇幅选项（按模式切换） */}
            <div className="space-y-2">
              <span className="text-xs text-muted-foreground">
                目标篇幅{lengthHint && <span className="text-emerald-600 font-medium"> · 约 {lengthHint}</span>}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {LENGTH_PRESETS[mode].map((p) => {
                  const active = lengthPreset === p.value;
                  return (
                    <button
                      key={p.value}
                      type="button"
                      onClick={() => setLengthPreset(p.value)}
                      className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors border ${
                        active
                          ? 'border-emerald-500 bg-emerald-500 text-white shadow-sm'
                          : 'border-border/60 bg-white text-muted-foreground hover:border-emerald-400 hover:text-emerald-700'
                      }`}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>
              {mode === 'condense' && (lengthPreset === '30s' || lengthPreset === '60s') && (
                <p className="text-xs text-muted-foreground/80">口播锚点：语速约 4 字/秒，{lengthPreset === '30s' ? '30' : '60'} 秒视频建议 {lengthPreset === '30s' ? '120-150' : '240-280'} 字</p>
              )}
            </div>

            <div className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
              <ModelSelector value={model} onChange={setModel} />
            </div>
            <div className="space-y-2">
              <Textarea
                placeholder={'例如：&#10;&#10;写个故事：少年在放学路上遇到一只会说话的猫，猫带他找到了一张藏宝图，最后发现宝藏是他爷爷留下的信。'}
                value={inputText}
                onChange={(e) => setInputText(e.target.value.slice(0, 3000))}
                className="min-h-[220px] resize-y text-sm leading-relaxed"
              />
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{MODES.find((m) => m.value === mode)?.desc}</span>
                <span className={inputText.length > 2900 ? 'text-destructive font-medium' : ''}>
                  {inputText.length}/3000 字
                </span>
              </div>
            </div>
            {/* 高级要求（可选）：默认收起，占位符随模式切换 */}
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
                    placeholder={EXTRA_PLACEHOLDER[mode]}
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
            <div className="flex flex-col sm:flex-row gap-2">
              <Button
                onClick={() => handleGenerate(false)}
                disabled={loading || inputText.trim().length < 10}
                size="lg"
                className="gap-2 shrink-0 h-12 px-8"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    处理中...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    {MODE_NAME[mode]}文案{model.cost > 1 ? `（耗${model.cost}次）` : ''}
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                onClick={() => handleGenerate(true)}
                disabled={loading}
                size="lg"
                className="gap-2 h-12"
                title="无需卡密，查看演示效果"
              >
                <RefreshCw className="h-4 w-4" />
                演示预览
              </Button>
            </div>

            <div className="rounded-lg bg-slate-50 border border-border/60 p-3 text-xs text-muted-foreground leading-relaxed">
              💡 小技巧：三种模式都不会跑偏你的故事——润色不改剧情、扩写不偏主线、缩写保留核心人物、事件、因果和结局。处理完可直接「拿去生成分镜」。
            </div>
          </CardContent>
        </Card>

        {/* 结果区 */}
        <Card className="lg:col-span-3 border-border/60">
          <CardHeader className="flex-row items-center justify-between space-y-0 gap-4 flex-wrap">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <FileText className="h-5 w-5 text-emerald-500" />
                处理结果
              </CardTitle>
              <CardDescription>
                {result
                  ? `${MODE_NAME[result.mode]} · 原文 ${result.inputLen} 字 → 现约 ${result.text.length} 字`
                  : '等待生成...'}
              </CardDescription>
            </div>
            {result && (
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleGenerate(false)}
                  disabled={loading || inputText.trim().length < 10}
                  className="gap-1.5 h-9"
                  title="用当前文案和模型重新处理"
                >
                  <RefreshCw className="h-4 w-4" />
                  重新生成
                </Button>
                <Button size="sm" variant="outline" onClick={handleCopy} className="gap-1.5 h-9">
                  {copied ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                  {copied ? '已复制' : '复制'}
                </Button>
              </div>
            )}
          </CardHeader>
          <CardContent>
            {!result && !loading && (
              <div className="py-20 text-center">
                <div className="mx-auto h-16 w-16 rounded-2xl bg-emerald-50 text-emerald-400 flex items-center justify-center mb-4">
                  <PenLine className="h-8 w-8" />
                </div>
                <p className="text-muted-foreground">在左侧输入故事文案，选择模式开始处理</p>
                <p className="text-xs text-muted-foreground/80 mt-2">也可以先点「演示预览」看看效果 ✨</p>
              </div>
            )}

            {loading && <GeneratingProgress stages={PROGRESS_STAGES[mode]} />}

            {result && !loading && (
              <div className="space-y-4">
                <div className="rounded-xl border border-border/60 bg-gradient-to-br from-white to-emerald-50/30 p-4">
                  <p className="text-sm leading-loose whitespace-pre-wrap break-words">{result.text}</p>
                </div>
                {/* 工作流联动：润色结果直接流向分镜/标题 */}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground">接下来：</span>
                  <Button size="sm" onClick={handleToStoryboard} className="gap-1.5 h-9">
                    <Clapperboard className="h-4 w-4" />
                    拿去生成分镜
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="outline" onClick={handleToTitles} className="gap-1.5 h-9">
                    <Sparkles className="h-4 w-4" />
                    生成爆款标题
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 错误反馈弹窗（生成失败时从 toast 按钮唤起） */}
      <FeedbackDialog open={feedbackOpen} onOpenChange={setFeedbackOpen} presetType="bug" presetContext={feedbackContext} />
    </div>
  );
}
