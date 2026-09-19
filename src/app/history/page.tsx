'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import ProtectedPage from '@/components/protected-page';
import { useCardAuth } from '@/lib/card-auth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  History as HistoryIcon,
  Clapperboard,
  Sparkles,
  Calendar,
  Loader2,
  ChevronRight,
  FileJson,
  Inbox as Empty,
  Trash2,
  Copy,
  CheckCircle2,
  ChevronDown,
  Film,
  PenLine,
  PersonStanding,
} from 'lucide-react';
import type {
  HistoryItem,
  StoryboardResult,
  TitleResult,
  PolishResult,
  CharacterViewsResult,
  PolishMode,
} from '@/lib/types';
import { setToolPrefill } from '@/lib/tool-prefill';
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function isStoryboard(item: HistoryItem): item is StoryboardResult {
  return item.type === 'storyboard';
}

function isPolish(item: HistoryItem): item is PolishResult {
  return item.type === 'polish';
}

function isCharviews(item: HistoryItem): item is CharacterViewsResult {
  return item.type === 'character_views';
}

const POLISH_MODE_NAME: Record<PolishMode, string> = { polish: '润色', expand: '扩写', condense: '缩写' };

/** 输入摘要（前 20 字），用于列表项与折叠态 */
function inputSummary(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > 20 ? oneLine.slice(0, 20) + '...' : oneLine;
}

export default function HistoryPage() {
  const { session } = useCardAuth();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [selected, setSelected] = useState<HistoryItem | null>(null);
  const [inputExpanded, setInputExpanded] = useState(false);
  const [copiedAll, setCopiedAll] = useState(false);
  const [copiedShot, setCopiedShot] = useState<number | null>(null);
  const [copiedTitle, setCopiedTitle] = useState<number | null>(null);
  const [copiedChar, setCopiedChar] = useState<number | null>(null);
  const [clearing, setClearing] = useState(false);
  // AI视频生成段：目标视频模型（时长上限）选择 + 段复制反馈
  const [videoModelId, setVideoModelId] = useState(DEFAULT_VIDEO_MODEL_ID);
  const [copiedSeg, setCopiedSeg] = useState<number | null>(null);

  const loadHistory = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/history', {
        headers: { Authorization: `Bearer ${session?.token}` },
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setItems(data.items || []);
      } else if (data.code === 'SESSION_INVALID') {
        // 忽略，路由会处理
      } else {
        // 如果后端未就绪，使用localStorage降级
        const local = localStorage.getItem('ai_video_tool_history');
        if (local) {
          try {
            setItems(JSON.parse(local));
          } catch { /* ignore */ }
        }
      }
    } catch {
      // 网络失败时降级
      const local = localStorage.getItem('ai_video_tool_history');
      if (local) {
        try {
          setItems(JSON.parse(local));
        } catch { /* ignore */ }
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadHistory();
  }, [session]);

  // 切换选中记录时重置折叠/复制状态
  useEffect(() => {
    setInputExpanded(false);
    setCopiedAll(false);
    setCopiedShot(null);
    setCopiedTitle(null);
    setCopiedSeg(null);
    setCopiedChar(null);
  }, [selected?.id]);

  const handleDelete = async (id: string) => {
    // 乐观移除
    const prev = items;
    setItems((cur) => cur.filter((i) => i.id !== id));
    if (selected?.id === id) setSelected(null);
    try {
      const res = await fetch(`/api/history?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session?.token}` },
      });
      if (!res.ok) throw new Error();
      toast.success('已删除该记录');
    } catch {
      setItems(prev); // 失败回滚
      toast.error('删除失败，请稍后再试');
    }
  };

  const handleClearAll = async () => {
    setClearing(true);
    const prev = items;
    setItems([]);
    setSelected(null);
    try {
      const res = await fetch('/api/history', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session?.token}` },
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error();
      toast.success(`已清空全部 ${data.deleted} 条记录`);
    } catch {
      setItems(prev); // 失败回滚
      toast.error('清空失败，请稍后再试');
    } finally {
      setClearing(false);
    }
  };

  // ===== 复制 =====（单镜头文本格式统一走 video-segments 的 shotToText）
  const storyboardToText = (item: StoryboardResult) => item.shots.map(shotToText).join('\n\n');

  // AI视频生成段：ai 模式与无创作方式标记的旧记录（旧版分镜即面向 AI 视频工具）参与分段
  const activeVideoModel = getVideoModel(videoModelId);
  const videoSegments: VideoSegment[] =
    selected && isStoryboard(selected) && (!selected.creationMode || selected.creationMode === 'ai')
      ? buildVideoSegments(selected.shots, activeVideoModel.maxDuration)
      : [];

  const handleCopySegment = (seg: VideoSegment) => {
    navigator.clipboard.writeText(segmentToText(seg));
    setCopiedSeg(seg.index);
    setTimeout(() => setCopiedSeg(null), 1500);
    toast.success(`已复制生成段 ${seg.index}`);
  };

  const titlesToText = (item: TitleResult) =>
    item.titles.map((t, i) => `${i + 1}. ${t}`).join('\n');

  const charviewsToText = (item: CharacterViewsResult) =>
    item.characters.map((c, i) => `${i + 1}. ${c.name}\n${c.prompt}`).join('\n\n');

  const handleCopyAll = () => {
    if (!selected) return;
    const text = isStoryboard(selected)
      ? storyboardToText(selected)
      : isPolish(selected)
        ? selected.text
        : isCharviews(selected)
          ? charviewsToText(selected)
          : titlesToText(selected);
    navigator.clipboard.writeText(text);
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
    toast.success('已复制全部内容');
  };

  // 复用：润色结果拿去生成分镜
  const handlePolishToStoryboard = (item: PolishResult) => {
    setToolPrefill('storyboard', item.text);
    router.push('/studio?tool=storyboard');
  };

  const handleCopyShot = (item: StoryboardResult, idx: number) => {
    const text = shotToText(item.shots[idx]);
    navigator.clipboard.writeText(text);
    setCopiedShot(idx);
    setTimeout(() => setCopiedShot(null), 1500);
  };

  const handleCopyTitle = (item: TitleResult, idx: number) => {
    navigator.clipboard.writeText(item.titles[idx]);
    setCopiedTitle(idx);
    setTimeout(() => setCopiedTitle(null), 1500);
  };

  return (
    <ProtectedPage>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-2">
            <HistoryIcon className="h-7 w-7 text-primary" />
            历史记录
          </h1>
          <p className="mt-1.5 text-muted-foreground text-sm sm:text-base">
            查看和管理你过往生成的分镜脚本与爆款标题
          </p>
        </div>

        <div className="grid lg:grid-cols-5 gap-6">
          {/* 列表 */}
          <Card className="lg:col-span-2 border-border/60 h-fit max-h-[70vh] overflow-hidden flex flex-col">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Calendar className="h-5 w-5 text-primary" />
                  生成记录
                </span>
                <span className="flex items-center gap-2">
                  <Badge variant="secondary">{items.length} 条</Badge>
                  {items.length > 0 && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={clearing}
                          className="h-7 px-2 gap-1 text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          清空
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>确认清空全部记录？</AlertDialogTitle>
                          <AlertDialogDescription>
                            将删除全部 {items.length} 条历史记录，删除后不可恢复，确定要清空吗？
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>取消</AlertDialogCancel>
                          <AlertDialogAction onClick={handleClearAll} className="bg-destructive hover:bg-destructive/90">
                            确认清空
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </span>
              </CardTitle>
              <CardDescription>最近生成的内容会显示在上方</CardDescription>
            </CardHeader>
            <CardContent className="flex-1 overflow-auto pt-0">
              {loading ? (
                <div className="py-12 text-center">
                  <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
                </div>
              ) : items.length === 0 ? (
                <div className="py-16 text-center">
                  <div className="mx-auto h-14 w-14 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mb-3">
                    <Empty className="h-7 w-7" />
                  </div>
                  <p className="text-sm text-muted-foreground">暂无历史记录</p>
                  <p className="text-xs text-muted-foreground/80 mt-1">去生成你的第一条分镜或标题吧</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {items.map((item) => {
                    const isStory = isStoryboard(item);
                    const isPol = isPolish(item);
                    const isCv = isCharviews(item);
                    const active = selected?.id === item.id;
                    const icon = isStory ? (
                      <Clapperboard className="h-4 w-4" />
                    ) : isPol ? (
                      <PenLine className="h-4 w-4" />
                    ) : isCv ? (
                      <PersonStanding className="h-4 w-4" />
                    ) : (
                      <Sparkles className="h-4 w-4" />
                    );
                    const iconCls = isStory
                      ? 'bg-blue-100 text-primary'
                      : isPol
                        ? 'bg-emerald-100 text-emerald-600'
                        : isCv
                          ? 'bg-amber-100 text-amber-600'
                          : 'bg-fuchsia-100 text-fuchsia-600';
                    const label = isStory
                      ? `分镜脚本 · ${item.shots.length} 镜`
                      : isPol
                        ? `文案${POLISH_MODE_NAME[item.mode]} · ${item.text.length} 字`
                        : isCv
                          ? `角色三视图 · ${item.characters.length} 个角色`
                          : `爆款标题 · ${item.titles.length} 组`;
                    return (
                      <div
                        key={item.id}
                        onClick={() => setSelected(item)}
                        className={`group rounded-xl border p-3 cursor-pointer transition-all ${
                          active
                            ? 'border-primary bg-primary/5 shadow-sm'
                            : 'border-border/60 hover:border-primary/40 hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <div className={`shrink-0 h-9 w-9 rounded-lg flex items-center justify-center ${iconCls}`}>
                            {icon}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-sm font-medium">{label}</span>
                              <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${active ? 'rotate-90' : ''}`} />
                            </div>
                            <div className="mt-1.5 text-sm text-muted-foreground line-clamp-1">
                              {inputSummary(item.inputText)}
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              {formatDate(item.createdAt)}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* 详情 */}
          <Card className="lg:col-span-3 border-border/60 min-w-0">
            <CardHeader className="flex-row items-start justify-between space-y-0 gap-3 flex-wrap">
              <div>
                <CardTitle className="text-lg">
                  {selected ? (
                    <span className="flex items-center gap-2">
                      {isStoryboard(selected) ? (
                        <><Clapperboard className="h-5 w-5 text-primary" /> 分镜脚本 · {selected.shots.length} 镜</>
                      ) : isPolish(selected) ? (
                        <><PenLine className="h-5 w-5 text-emerald-500" /> 文案{POLISH_MODE_NAME[selected.mode]} · 约 {selected.text.length} 字</>
                      ) : isCharviews(selected) ? (
                        <><PersonStanding className="h-5 w-5 text-amber-500" /> 角色三视图 · {selected.characters.length} 个角色</>
                      ) : (
                        <><Sparkles className="h-5 w-5 text-fuchsia-500" /> 爆款标题 · {selected.titles.length} 组</>
                      )}
                    </span>
                  ) : (
                    '记录详情'
                  )}
                </CardTitle>
                <CardDescription>
                  {selected ? formatDate(selected.createdAt) : '选择左侧记录查看详情'}
                </CardDescription>
              </div>
              {selected && (
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={handleCopyAll} className="gap-1.5 h-9">
                    {copiedAll ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                    {copiedAll ? '已复制' : '复制全部'}
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="sm" variant="ghost" className="gap-1.5 h-9 text-destructive hover:text-destructive">
                        <Trash2 className="h-4 w-4" />
                        删除
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>确认删除？</AlertDialogTitle>
                        <AlertDialogDescription>
                          删除后不可恢复，确定要删除这条记录吗？
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>取消</AlertDialogCancel>
                        <AlertDialogAction onClick={() => handleDelete(selected.id)} className="bg-destructive hover:bg-destructive/90">
                          确认删除
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              )}
            </CardHeader>
            <CardContent>
              {!selected ? (
                <div className="py-20 text-center">
                  <div className="mx-auto h-16 w-16 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mb-4">
                    <FileJson className="h-8 w-8" />
                  </div>
                  <p className="text-muted-foreground">点击左侧记录查看详情</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {/* 输入原文：默认折叠，点击展开 */}
                  <div className="rounded-xl bg-slate-50 border border-border/60">
                    <button
                      type="button"
                      onClick={() => setInputExpanded((v) => !v)}
                      className="w-full flex items-center justify-between gap-2 p-4 text-left"
                    >
                      <span className="min-w-0">
                        <span
                          className={`font-semibold text-xs mr-2 ${
                            isStoryboard(selected)
                              ? 'text-primary'
                              : isPolish(selected)
                                ? 'text-emerald-600'
                                : isCharviews(selected)
                                  ? 'text-amber-600'
                                  : 'text-fuchsia-600'
                          }`}
                        >
                          {isStoryboard(selected)
                            ? '输入文案'
                            : isPolish(selected)
                              ? '原始故事'
                              : isCharviews(selected)
                                ? '故事文案'
                                : '视频主题'}
                        </span>
                        {!inputExpanded && (
                          <span className="text-sm text-muted-foreground">{inputSummary(selected.inputText)}</span>
                        )}
                      </span>
                      <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${inputExpanded ? 'rotate-180' : ''}`} />
                    </button>
                    {inputExpanded && (
                      <p className="px-4 pb-4 pt-0 text-sm leading-relaxed text-muted-foreground whitespace-pre-wrap break-words">
                        {selected.inputText}
                      </p>
                    )}
                  </div>

                  {/* 结果 */}
                  {isPolish(selected) ? (
                    <div className="space-y-3">
                      <div className="rounded-xl border border-emerald-200 bg-emerald-50/30 p-4">
                        <p className="text-sm leading-loose whitespace-pre-wrap break-words">{selected.text}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs text-muted-foreground">接下来：</span>
                        <Button
                          size="sm"
                          onClick={() => handlePolishToStoryboard(selected)}
                          className="gap-1.5 h-9"
                          title="用这段文案生成分镜脚本"
                        >
                          <Clapperboard className="h-4 w-4" />
                          拿去生成分镜
                        </Button>
                      </div>
                    </div>
                  ) : isCharviews(selected) ? (
                    <div className="space-y-3">
                      {selected.characters.map((c, idx) => {
                        const charCopied = copiedChar === idx;
                        return (
                          <div
                            key={idx}
                            className="group rounded-xl border border-border/60 bg-white p-4"
                          >
                            <div className="flex items-start justify-between gap-3 mb-2">
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
                                onClick={() => {
                                  navigator.clipboard.writeText(c.prompt);
                                  setCopiedChar(idx);
                                  setTimeout(() => setCopiedChar(null), 1500);
                                  toast.success(`已复制「${c.name}」的三视图提示词`);
                                }}
                                className="shrink-0 rounded-lg border border-border p-1.5 text-muted-foreground hover:text-amber-600 hover:border-amber-300 hover:bg-amber-50/60 transition-colors"
                                title="复制这条提示词"
                              >
                                {charCopied ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                              </button>
                            </div>
                            <p className="text-sm leading-relaxed text-slate-700 break-words">{c.prompt}</p>
                          </div>
                        );
                      })}
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        复制提示词到即梦 / Seedream 等图像模型生成角色设定图，作为参考图配合分镜生成段使用，人物一致性更稳。
                      </p>
                    </div>
                  ) : isStoryboard(selected) ? (
                    <div className="space-y-2.5">
                      {videoSegments.length > 0 && (
                        <div className="rounded-xl border border-violet-200 bg-violet-50/40 p-4 space-y-3">
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
                            每个生成段的总时长已控制在所选模型的单次生成上限内，点击「复制本段」后可直接粘贴到视频模型连续生成。
                          </p>
                        </div>
                      )}
                      {selected.shots.map((shot, idx) => {
                        const shotCopied = copiedShot === idx;
                        return (
                          <div
                            key={shot.shotNumber}
                            className="group rounded-xl border border-border/60 p-4 bg-white"
                          >
                            <div className="flex flex-wrap items-center gap-2 mb-2">
                              <Badge variant="secondary" className="bg-primary text-primary-foreground">
                                镜头 {String(shot.shotNumber).padStart(2, '0')}
                              </Badge>
                              {shot.sceneId !== undefined && (
                                <Badge variant="outline" className="text-xs text-sky-700 border-sky-200 bg-sky-50/60 whitespace-normal shrink">
                                  场景 {shot.sceneId}
                                </Badge>
                              )}
                              <Badge variant="outline" className="text-xs whitespace-normal shrink">时长 {shot.duration}</Badge>
                              <Badge variant="outline" className="text-xs text-fuchsia-700 border-fuchsia-200 bg-fuchsia-50/50 whitespace-normal shrink">
                                {shot.cameraMove}
                              </Badge>
                              <button
                                onClick={() => handleCopyShot(selected, idx)}
                                className="ml-auto shrink-0 rounded-lg border border-border p-1.5 text-muted-foreground hover:text-primary hover:border-primary/40 hover:bg-primary/5 transition-colors opacity-0 group-hover:opacity-100"
                                title="复制这个镜头"
                              >
                                {shotCopied ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                              </button>
                            </div>
                            <div className="text-sm">
                              <span className="font-semibold text-xs">画面 · </span>
                              <span className="leading-relaxed break-words">{shot.sceneDescription}</span>
                            </div>
                            {shot.dialogue && (
                              <div className="mt-2 rounded-lg bg-slate-50 border-l-2 border-indigo-400 px-3 py-2 text-sm">
                                <span className="font-semibold text-indigo-600 text-xs">台词 · </span>
                                <span className="break-words">{shot.dialogue}</span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {selected.titles.map((t, i) => {
                        const titleCopied = copiedTitle === i;
                        return (
                          <div
                            key={i}
                            className="group rounded-xl border border-border/60 bg-white p-3.5 text-sm flex items-start gap-3"
                          >
                            <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-fuchsia-100 text-fuchsia-700 text-xs font-bold">
                              {i + 1}
                            </span>
                            <p className="leading-relaxed flex-1">{t}</p>
                            <button
                              onClick={() => handleCopyTitle(selected, i)}
                              className="shrink-0 rounded-lg border border-border p-1.5 text-muted-foreground hover:text-primary hover:border-primary/40 hover:bg-primary/5 transition-colors opacity-0 group-hover:opacity-100"
                              title="复制这条"
                            >
                              {titleCopied ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </ProtectedPage>
  );
}
