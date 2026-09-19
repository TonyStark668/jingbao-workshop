'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCardAuth } from '@/lib/card-auth';
import { SITE_NAME, SITE_TAGLINE } from '@/lib/site';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Clapperboard,
  Sparkles,
  Shield,
  Zap,
  Clock,
  CheckCircle2,
  ArrowRight,
  Loader2,
  Film,
  Rocket,
  PenLine,
  PersonStanding,
} from 'lucide-react';
import { toast } from 'sonner';

function scrollToCardInput() {
  const el = document.getElementById('card-input');
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

export default function HomePage() {
  const { session, isLoading, verifyCard, logout } = useCardAuth();
  const router = useRouter();
  const [cardCode, setCardCode] = useState('');
  const [verifying, setVerifying] = useState(false);

  const handleVerify = async () => {
    if (!cardCode.trim()) {
      toast.error('请输入卡密');
      return;
    }
    const clean = cardCode.trim().toUpperCase();
    if (!/^SP-[A-Z0-9]{12}$/.test(clean)) {
      toast.error('卡密格式错误，格式应为 SP-XXXXXXXXXXXX');
      return;
    }
    setVerifying(true);
    try {
      const ok = await verifyCard(clean);
      if (ok) {
        setTimeout(() => router.push('/studio'), 300);
      }
    } finally {
      setVerifying(false);
    }
  };

  const features = [
    {
      icon: Clapperboard,
      title: '文本转分镜脚本',
      desc: '粘贴文案一键生成专业分镜，包含画面描述、台词旁白、预估时长、运镜建议。',
      color: 'from-blue-500 to-indigo-500',
    },
    {
      icon: Sparkles,
      title: 'AI爆款标题生成',
      desc: '一次输出10组适配抖音/B站/小红书的爆款标题，覆盖多种风格与槽点。',
      color: 'from-fuchsia-500 to-pink-500',
    },
    {
      icon: PenLine,
      title: '文案润色·扩写·缩写',
      desc: '自己写的故事也能打磨：润色不改剧情、扩写不偏主线、缩写保留梗概，产出即可生成分镜。',
      color: 'from-emerald-500 to-teal-500',
    },
    {
      icon: PersonStanding,
      title: '角色三视图提示词',
      desc: '从故事自动识别核心角色，生成三视图设定图提示词，配合即梦/Seedream生图做角色参考，人物一致性更稳。',
      color: 'from-amber-500 to-orange-500',
    },
    {
      icon: Shield,
      title: '卡密激活即用',
      desc: '无需注册登录、无需绑定手机，输入卡密直接使用，操作简单、隐私安全。',
      color: 'from-slate-500 to-slate-600',
    },
  ];

  return (
    <div className="space-y-16 sm:space-y-24">
      {/* Hero */}
      <section className="pt-4 sm:pt-8">
        <div className="text-center max-w-3xl mx-auto">
          <Badge variant="secondary" className="mb-5 px-3 py-1 text-xs gap-1.5 border-primary/20 bg-primary/5">
            <Zap className="h-3 w-3 text-primary" />
            短视频创作者的效率神器
          </Badge>
          <h1 className="text-3xl sm:text-5xl font-bold tracking-tight leading-tight">
            AI 帮你写
            <span className="bg-gradient-to-r from-primary via-indigo-500 to-fuchsia-500 bg-clip-text text-transparent">
              {' '}爆款脚本与标题{' '}
            </span>
          </h1>
          <p className="mt-5 text-base sm:text-lg text-muted-foreground leading-relaxed">
            面向抖音、B站、小红书创作者的 AI 创作工具箱
            <br className="hidden sm:block" />
            粘贴文案即可生成专业分镜，再也不用熬夜想脚本啦
          </p>
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
            {session ? (
              <>
                <Link href="/studio?tool=storyboard">
                  <Button size="lg" className="gap-2 w-full sm:w-auto shadow-lg shadow-primary/20">
                    <Clapperboard className="h-5 w-5" />
                    开始使用
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
                <Link href="/studio?tool=titles">
                  <Button size="lg" variant="outline" className="gap-2 w-full sm:w-auto">
                    <Sparkles className="h-5 w-5" />
                    生成爆款标题
                  </Button>
                </Link>
              </>
            ) : (
              <>
                <Button size="lg" className="gap-2 w-full sm:w-auto shadow-lg shadow-primary/20" onClick={scrollToCardInput}>
                  <Rocket className="h-5 w-5" />
                  输入卡密激活
                </Button>
                <a href="#features" onClick={(e) => { e.preventDefault(); document.getElementById('features')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>
                  <Button size="lg" variant="outline" className="gap-2 w-full sm:w-auto">
                    了解功能
                  </Button>
                </a>
              </>
            )}
          </div>
        </div>

        {/* Product Mock Card */}
        <div className="mt-12 sm:mt-16 max-w-4xl mx-auto">
          <div className="rounded-2xl border border-border bg-white shadow-2xl shadow-primary/5 p-1 overflow-hidden">
            <div className="rounded-xl bg-gradient-to-br from-slate-50 via-white to-indigo-50/50 p-5 sm:p-8">
              <div className="flex items-center gap-2 mb-5">
                <div className="h-3 w-3 rounded-full bg-red-400"></div>
                <div className="h-3 w-3 rounded-full bg-amber-400"></div>
                <div className="h-3 w-3 rounded-full bg-emerald-400"></div>
                <div className="ml-2 text-xs text-muted-foreground font-mono">ai-video-tool.app</div>
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="rounded-xl bg-white p-4 border border-border/60 shadow-sm">
                  <div className="flex items-center gap-2 text-sm font-semibold text-primary mb-2">
                    <Clapperboard className="h-4 w-4" /> 分镜脚本生成示例
                  </div>
                  <div className="space-y-2 text-sm">
                    <div className="rounded-lg bg-slate-50 p-2.5 border-l-2 border-primary">
                      <div className="font-semibold text-xs">镜头 1 · 3秒 · 推镜</div>
                      <div className="text-muted-foreground text-xs mt-1">清晨阳光下，主角走进咖啡店，微笑面对镜头</div>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-2.5 border-l-2 border-fuchsia-400">
                      <div className="font-semibold text-xs">镜头 2 · 5秒 · 固定</div>
                      <div className="text-muted-foreground text-xs mt-1">特写咖啡拉花，配旁白：&ldquo;一天的美好，从这杯开始&rdquo;</div>
                    </div>
                  </div>
                </div>
                <div className="rounded-xl bg-white p-4 border border-border/60 shadow-sm">
                  <div className="flex items-center gap-2 text-sm font-semibold text-fuchsia-600 mb-2">
                    <Sparkles className="h-4 w-4" /> 爆款标题生成示例
                  </div>
                  <div className="space-y-1.5 text-xs">
                    <div className="rounded-md bg-fuchsia-50 text-fuchsia-800 px-2.5 py-1.5">1. 闺蜜以为我去了巴黎！其实就在这家店…</div>
                    <div className="rounded-md bg-indigo-50 text-indigo-800 px-2.5 py-1.5">2. 打工人必看！5分钟学会拿铁艺术</div>
                    <div className="rounded-md bg-emerald-50 text-emerald-800 px-2.5 py-1.5">3. 后悔没早知道！隐藏菜单点单攻略</div>
                    <div className="rounded-md bg-amber-50 text-amber-800 px-2.5 py-1.5">4. 月薪3k也能精致生活的小秘密</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="scroll-mt-20">
        <div className="text-center mb-10">
          <h2 className="text-2xl sm:text-3xl font-bold">核心功能，直击创作痛点</h2>
          <p className="mt-3 text-muted-foreground">四大核心 AI 能力，覆盖文案、分镜、标题、角色设定全流程</p>
        </div>
        <div className="grid md:grid-cols-3 gap-5">
          {features.map((f) => {
            const Icon = f.icon;
            return (
              <Card key={f.title} className="group relative overflow-hidden border-border/60 hover:border-primary/40 transition-all duration-300 hover:shadow-xl hover:shadow-primary/5 hover:-translate-y-1">
                <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${f.color}`}></div>
                <CardHeader>
                  <div className={`inline-flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br ${f.color} text-white shadow-md mb-3`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <CardTitle className="text-lg">{f.title}</CardTitle>
                  <CardDescription className="leading-relaxed">{f.desc}</CardDescription>
                </CardHeader>
              </Card>
            );
          })}
        </div>
      </section>

      {/* Activation + Benefits */}
      <section id="card-input" className="scroll-mt-20">
        <div className="text-center mb-10">
          <h2 className="text-2xl sm:text-3xl font-bold">卡密激活，即用即走</h2>
          <p className="mt-3 text-muted-foreground">无需注册 · 无需绑手机 · 隐私安全</p>
        </div>

        <div className="grid lg:grid-cols-5 gap-6 max-w-5xl mx-auto">
          {/* Benefits */}
          <Card className="lg:col-span-2 border-primary/30 bg-gradient-to-br from-primary/5 via-white to-white relative overflow-hidden">
            <div className="absolute -top-16 -right-16 h-40 w-40 rounded-full bg-primary/10 blur-3xl"></div>
            <CardHeader>
              <Badge className="w-fit bg-primary text-primary-foreground hover:bg-primary">会员权益</Badge>
              <CardTitle className="mt-2 text-xl">激活后享受以下权益</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {[
                '爆款标题一键生成 · 一次10条，多风格全覆盖',
                '专业分镜脚本 · 文案粘进来直接能开拍',
                '文案润色·扩写·缩写 · 自己写的故事也能打磨',
                '角色三视图提示词 · 生图做角色参考，人物一致性更稳',
                '五大AI模型随便换 · 不满意一秒重生成',
                '高级要求定制 · 加一句话，AI就听你的',
                '生成历史云端留存 · 随时回看一键复用',
                '失败不扣次数 · 每一次都花在结果上',
              ].map((item) => (
                <div key={item} className="flex items-start gap-2 text-sm">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
                  <span>{item}</span>
                </div>
              ))}
              <div className="mt-4 rounded-lg bg-slate-50 p-3 text-xs text-muted-foreground border border-border/60 flex gap-2 items-start">
                <Clock className="h-4 w-4 mt-0.5 shrink-0" />
                <span>每日额度每天 0 点自动重置，时长内每天都能用</span>
              </div>
            </CardContent>
          </Card>

          {/* Card Input */}
          <Card className="lg:col-span-3 border-border/60">
            <CardHeader>
              <div className="flex items-center gap-2">
                <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                  <Shield className="h-5 w-5" />
                </div>
                <div>
                  <CardTitle className="text-lg">输入卡密激活使用</CardTitle>
                  <CardDescription>
                    {session ? '当前卡密已激活，尽情创作吧 ✨' : '卡密格式：SP-XXXXXXXXXXXX（12位大写字母数字）'}
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {session ? (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-center">
                  <Film className="h-10 w-10 text-emerald-500 mx-auto mb-3" />
                  <div className="font-semibold text-emerald-800 mb-1">卡密已激活</div>
                  <div className="text-sm text-emerald-700/80 font-mono mb-2">{session.cardCode}</div>
                  <div className="text-xs text-emerald-700/70 mb-4">
                    今日已用 {session.dailyUsed}/{session.dailyLimit} 次 · 有效期至 {new Date(session.cardExpiresAt).toLocaleDateString('zh-CN')}
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2 justify-center">
                    <Link href="/studio?tool=storyboard">
                      <Button className="gap-1.5 w-full sm:w-auto">
                        <Clapperboard className="h-4 w-4" /> 去写分镜
                      </Button>
                    </Link>
                    <Link href="/studio?tool=titles">
                      <Button variant="outline" className="gap-1.5 w-full sm:w-auto">
                        <Sparkles className="h-4 w-4" /> 生成标题
                      </Button>
                    </Link>
                    <Button variant="ghost" size="sm" onClick={logout} className="text-muted-foreground">
                      切换卡密
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <Input
                      placeholder="请输入卡密，例如 SP-A3K9M2X7P5Q1"
                      value={cardCode}
                      onChange={(e) => setCardCode(e.target.value.toUpperCase())}
                      onKeyDown={(e) => e.key === 'Enter' && handleVerify()}
                      className="font-mono tracking-wider h-12 text-base"
                      maxLength={16}
                      disabled={verifying || isLoading}
                    />
                    <Button
                      size="lg"
                      onClick={handleVerify}
                      disabled={verifying || isLoading}
                      className="h-12 px-8 gap-2 shrink-0"
                    >
                      {verifying ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          验证中...
                        </>
                      ) : (
                        <>
                          <Zap className="h-4 w-4" />
                          立即激活
                        </>
                      )}
                    </Button>
                  </div>
                  <div className="rounded-lg bg-slate-50 border border-border/60 p-4 text-sm text-muted-foreground">
                    <div className="font-semibold text-foreground mb-2">💡 如何获取卡密？</div>
                    <ol className="list-decimal list-inside space-y-1 text-xs leading-relaxed">
                      <li>在小红书/微信联系客服，按需购买卡密</li>
                      <li>时长随你选：月卡 / 季卡 / 半年卡 / 年卡都支持</li>
                      <li>收到卡密后在上方输入框粘贴，即刻开用</li>
                    </ol>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </section>

      {/* 页脚（含低调的管理后台入口） */}
      <footer className="border-t border-border/60 py-6">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 flex items-center justify-between gap-4">
          <p className="text-xs text-muted-foreground">{SITE_NAME} · {SITE_TAGLINE}</p>
          <a
            href="/admin"
            className="text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors"
          >
            管理入口
          </a>
        </div>
      </footer>
    </div>
  );
}
