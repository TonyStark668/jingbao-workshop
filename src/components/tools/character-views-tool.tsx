'use client';

import { useEffect, useState } from 'react';
import { useCardAuth } from '@/lib/card-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  PersonStanding,
  Copy,
  CheckCircle2,
  ChevronDown,
  Loader2,
  RefreshCw,
  FileText,
  Image as ImageIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { ModelSelector, type ModelSelection } from '@/components/model-selector';
import { GeneratingProgress } from '@/components/generating-progress';
import { FeedbackDialog, type FeedbackContext } from '@/components/feedback-dialog';
import { consumeToolPrefill } from '@/lib/tool-prefill';
import type { CharacterView } from '@/lib/types';

// 演示预览（非真实AI生成）
const MOCK_CHARACTERS: CharacterView[] = [
  {
    name: '小杰（男主）',
    prompt:
      '3D动画风格，17岁黑色短发少年，穿黑色连帽衫、深色长裤和白色运动鞋，背一个深蓝色双肩包，身形清瘦挺拔。同一画面中水平排列展示该角色的正面、侧面、背面三个视角的全身像，自然站姿，纯色浅灰背景，统一均匀光线，画面无文字、无水印、无Logo。',
  },
  {
    name: '银白狐狸',
    prompt:
      '3D动画风格，一只银白色皮毛的小狐狸，琥珀色眼睛，蓬松的长尾巴，体态轻盈优雅。同一画面中水平排列展示该狐狸的正面、侧面、背面三个视角的全身像，自然站姿，纯色浅灰背景，统一均匀光线，画面无文字、无水印、无Logo。',
  },
];

export function CharacterViewsTool() {
  const { session, refreshUsage, logout } = useCardAuth();
  const [inputText, setInputText] = useState('');
  const [extra, setExtra] = useState('');
  const [extraOpen, setExtraOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [characters, setCharacters] = useState<CharacterView[] | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [model, setModel] = useState<ModelSelection>({ cost: 1 });
  // 错误反馈：生成失败时 toast 上带"反馈"按钮，自动附带失败上下文
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackContext, setFeedbackContext] = useState<FeedbackContext | undefined>();

  // 跨工具联动：分镜结果页点"生成角色三视图"时回填故事文案
  useEffect(() => {
    const prefill = consumeToolPrefill('charviews');
    if (prefill) setInputText(prefill);
  }, []);

  const openErrorFeedback = (error: string) => {
    setFeedbackContext({ tool: '角色三视图', model: model.model || model.provider, error: error.slice(0, 300) });
    setFeedbackOpen(true);
  };

  const handleGenerate = async (useMock = false) => {
    const text = inputText.trim();
    if (!text) {
      toast.error('请输入故事文案');
      return;
    }
    if (text.length < 20) {
      toast.error('故事太短啦，至少需要 20 个字（需要有人物和情节才能识别角色）');
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
        setCharacters(MOCK_CHARACTERS);
        toast.success('演示三视图提示词已生成（预览模式）');
      } else {
        const res = await fetch('/api/ai/character-views', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session?.token}`,
          },
          body: JSON.stringify({ text, provider: model.provider, model: model.model, extra: extra.trim() || undefined }),
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
        setCharacters(data.characters as CharacterView[]);
        await refreshUsage();
        toast.success(`已生成 ${data.characters.length} 个角色的三视图提示词！`);
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

  const handleCopyOne = (idx: number) => {
    if (!characters) return;
    navigator.clipboard.writeText(characters[idx].prompt);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 1500);
    toast.success(`已复制「${characters[idx].name}」的三视图提示词`);
  };

  const handleCopyAll = () => {
    if (!characters) return;
    const text = characters.map((c, i) => `${i + 1}. ${c.name}\n${c.prompt}`).join('\n\n');
    navigator.clipboard.writeText(text);
    toast.success('已复制全部角色的三视图提示词');
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Badge variant="secondary">今日 {session?.dailyUsed}/{session?.dailyLimit}</Badge>
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-2">
          <PersonStanding className="h-7 w-7 text-amber-500" />
          角色三视图提示词
        </h1>
        <p className="mt-1.5 text-muted-foreground text-sm sm:text-base">
          从故事中自动识别核心角色，生成可直接用于即梦 / Seedream 等图像模型的三视图设定图提示词，生图后作为角色参考图喂给视频模型，人物一致性更稳
        </p>
      </div>

      <div className="grid lg:grid-cols-5 gap-6">
        {/* 输入区 */}
        <Card className="lg:col-span-2 border-border/60 h-fit">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <FileText className="h-5 w-5 text-amber-500" />
              输入故事文案
            </CardTitle>
            <CardDescription>AI 自动识别核心角色（1-4 个），人物锚点与分镜工具同源</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
              <ModelSelector value={model} onChange={setModel} />
            </div>
            <div className="space-y-2">
              <Textarea
                placeholder={'例如：&#10;&#10;17岁的黑发少年小杰在放学路上遇到一只银白色的狐狸，狐狸带着他穿过老巷子，找到了爷爷留下的信…'}
                value={inputText}
                onChange={(e) => setInputText(e.target.value.slice(0, 2000))}
                className="min-h-[240px] resize-y text-sm leading-relaxed"
              />
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>故事里写清人物特征，锚点更准</span>
                <span className={inputText.length > 1900 ? 'text-destructive font-medium' : ''}>
                  {inputText.length}/2000 字
                </span>
              </div>
            </div>
            {/* 高级要求（可选）：默认收起，用于补充/覆盖角色细节 */}
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
                    placeholder="如：男主穿红色卫衣 / 主角要带佩剑 / 狐狸尾巴尖是黑色的"
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
                disabled={loading || inputText.trim().length < 20}
                size="lg"
                className="gap-2 shrink-0 h-12 px-8"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    生成中...
                  </>
                ) : (
                  <>
                    <PersonStanding className="h-4 w-4" />
                    生成三视图提示词{model.cost > 1 ? `（耗${model.cost}次）` : ''}
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
              💡 推荐工作流：故事 → 生成分镜（AI视频模式）→ 点「角色三视图」→ 复制提示词到即梦/Seedream 生图 → 用参考图 + 分镜生成段做视频。锚点与分镜同源，人物一致性最大化。
            </div>
          </CardContent>
        </Card>

        {/* 结果区 */}
        <Card className="lg:col-span-3 border-border/60">
          <CardHeader className="flex-row items-center justify-between space-y-0 gap-4 flex-wrap">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <ImageIcon className="h-5 w-5 text-amber-500" />
                三视图提示词
              </CardTitle>
              <CardDescription>
                {characters ? `共 ${characters.length} 个角色 · 每条提示词可单独复制给图像模型` : '等待生成...'}
              </CardDescription>
            </div>
            {characters && (
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleGenerate(false)}
                  disabled={loading || inputText.trim().length < 20}
                  className="gap-1.5 h-9"
                  title="用当前故事和模型重新生成"
                >
                  <RefreshCw className="h-4 w-4" />
                  重新生成
                </Button>
                <Button size="sm" variant="outline" onClick={handleCopyAll} className="gap-1.5 h-9">
                  <Copy className="h-4 w-4" />
                  复制全部
                </Button>
              </div>
            )}
          </CardHeader>
          <CardContent>
            {!characters && !loading && (
              <div className="py-20 text-center">
                <div className="mx-auto h-16 w-16 rounded-2xl bg-amber-50 text-amber-400 flex items-center justify-center mb-4">
                  <PersonStanding className="h-8 w-8" />
                </div>
                <p className="text-muted-foreground">在左侧输入故事，一键生成角色三视图提示词</p>
                <p className="text-xs text-muted-foreground/80 mt-2">也可以先点「演示预览」看看效果 ✨</p>
              </div>
            )}

            {loading && (
              <GeneratingProgress
                stages={['正在通读你的故事…', '正在识别核心角色…', '正在编写三视图提示词…', '好内容值得等待，即将完成…']}
              />
            )}

            {characters && !loading && (
              <div className="space-y-3">
                {characters.map((c, idx) => {
                  const copied = copiedIdx === idx;
                  return (
                    <div
                      key={idx}
                      className="group rounded-xl border border-border/60 bg-gradient-to-br from-white to-amber-50/30 p-4 hover:shadow-md hover:border-amber-300/60 transition-all"
                    >
                      <div className="flex items-start justify-between gap-3 mb-2.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-500 text-white text-xs font-bold">
                            {idx + 1}
                          </span>
                          <span className="text-sm font-semibold truncate">{c.name}</span>
                          <Badge variant="outline" className="text-xs text-amber-700 border-amber-200 bg-amber-50/60 shrink">
                            三视图
                          </Badge>
                        </div>
                        <button
                          onClick={() => handleCopyOne(idx)}
                          className="shrink-0 rounded-lg border border-border p-2 text-muted-foreground hover:text-amber-600 hover:border-amber-300 hover:bg-amber-50/60 transition-colors"
                          title="复制这条提示词"
                        >
                          {copied ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                        </button>
                      </div>
                      <p className="text-sm leading-relaxed text-slate-700 break-words">{c.prompt}</p>
                    </div>
                  );
                })}
                <p className="text-xs text-muted-foreground leading-relaxed">
                  使用方法：复制某个角色的提示词 → 粘贴到即梦 / Seedream 等图像生成模型 → 得到该角色的三视图设定图 → 在视频模型中以参考图方式使用，配合分镜生成段生成视频。
                </p>
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
