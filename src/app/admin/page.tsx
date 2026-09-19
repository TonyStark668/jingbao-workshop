'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { SITE_NAME } from '@/lib/site';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Film,
  Loader2,
  ShieldCheck,
  RefreshCw,
  CalendarClock,
  LogOut,
  Home,
  CreditCard,
  ScrollText,
  Settings,
  Lock,
  Search,
  Plus,
  Download,
  UploadCloud,
  Database,
  Copy,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Snowflake,
  Ban,
  PlayCircle,
  KeyRound,
  Cpu,
  Trash2,
  ShieldAlert,
  MessageCircle,
} from 'lucide-react';
import { toast } from 'sonner';

const ADMIN_SESSION_KEY = 'ai_video_tool_admin_session';

interface AdminSession {
  token: string;
  /** JWT 过期时间（ISO 字符串），用于前端定时退出 */
  expiresAt: string;
  admin: { id: number; username: string; role: string };
  /** 登录时检测：是否仍在使用出厂默认密码（true 时页面顶部显示提醒条） */
  usingDefaultPassword?: boolean;
}

// ========= 通用 =========
/** 带鉴权的 fetch 包装类型：收到 401 时自动触发统一的过期处理 */
type AdminFetcher = (input: string, init?: RequestInit, silent401?: boolean) => Promise<Response>;

function withAuth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

const STATUS_META: Record<string, { label: string; cls: string }> = {
  unused: { label: '未激活', cls: 'bg-slate-50 text-slate-600 border-slate-200' },
  active: { label: '已激活', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  frozen: { label: '已冻结', cls: 'bg-sky-50 text-sky-700 border-sky-200' },
  revoked: { label: '已作废', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  expired: { label: '已过期', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
};

function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] || STATUS_META.unused;
  return <Badge variant="outline" className={meta.cls}>{meta.label}</Badge>;
}

// 有效期快捷选项（1个月=30天 … 1年=365天）
const QUICK_VALID_OPTIONS = [
  { label: '1个月', days: 30 },
  { label: '3个月', days: 90 },
  { label: '6个月', days: 180 },
  { label: '1年', days: 365 },
] as const;

// ========= 登录页 =========
function AdminLogin({ onLogin }: { onLogin: (s: AdminSession) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [answer, setAnswer] = useState('');
  const [captcha, setCaptcha] = useState<{ captchaId: string; question: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchCaptcha = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/captcha');
      const data = await res.json();
      if (data.success) setCaptcha({ captchaId: data.captchaId, question: data.question });
    } catch {
      toast.error('验证码获取失败，请刷新重试');
    }
  }, []);

  useEffect(() => {
    fetchCaptcha();
  }, [fetchCaptcha]);

  const handleLogin = async () => {
    if (!username.trim() || !password) {
      toast.error('请输入账号和密码');
      return;
    }
    if (!answer.trim()) {
      toast.error('请输入验证码答案');
      return;
    }
    if (!captcha) {
      toast.error('验证码未加载，请点击刷新');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          captchaId: captcha.captchaId,
          answer: parseInt(answer, 10),
          username: username.trim(),
          password,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        toast.error(data.error || '登录失败');
        setAnswer('');
        fetchCaptcha();
        return;
      }
      const session: AdminSession = {
        token: data.token,
        expiresAt: data.expiresAt,
        admin: data.admin,
        usingDefaultPassword: !!data.usingDefaultPassword,
      };
      localStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify(session));
      toast.success('登录成功');
      onLogin(session);
    } catch {
      toast.error('网络错误，请稍后再试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-4">
      <Card className="w-full max-w-md border-border/60 shadow-lg">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-md shadow-primary/20">
            <ShieldCheck className="h-7 w-7" />
          </div>
          <CardTitle className="text-xl">管理后台登录</CardTitle>
          <CardDescription>仅限管理员访问，连续 5 次失败将锁定 IP 30 分钟</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">账号</label>
            <Input
              placeholder="管理员账号"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">密码</label>
            <Input
              type="password"
              placeholder="管理员密码"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
              autoComplete="current-password"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">验证码</label>
            <div className="flex gap-2">
              <div className="flex h-10 min-w-[110px] items-center justify-center rounded-md border border-border bg-slate-50 font-mono text-base font-bold tracking-wider select-none">
                {captcha?.question || '加载中...'}
              </div>
              <Input
                placeholder="输入计算结果"
                value={answer}
                onChange={(e) => setAnswer(e.target.value.replace(/[^0-9-]/g, ''))}
                onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                className="flex-1"
                inputMode="numeric"
              />
              <Button variant="outline" size="icon" onClick={() => { setAnswer(''); fetchCaptcha(); }} title="换一题">
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <Button onClick={handleLogin} disabled={loading} className="w-full h-11 gap-2">
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> 登录中...
              </>
            ) : (
              <>
                <Lock className="h-4 w-4" /> 登录管理后台
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

// ========= Tab 1: 卡密管理 =========
interface CardRow {
  id: number;
  code: string;
  status: string;
  valid_days: number;
  daily_limit: number;
  remark: string | null;
  activated_at: string | null;
  expires_at: string | null;
  last_used_at: string | null;
  created_at: string;
}

function CardsPanel({ fetcher }: { fetcher: AdminFetcher }) {
  const [rows, setRows] = useState<CardRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [searchCode, setSearchCode] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [loading, setLoading] = useState(true);
  const [genOpen, setGenOpen] = useState(false);
  const [genResult, setGenResult] = useState<string[] | null>(null);
  const [genCopied, setGenCopied] = useState(false);

  // 生成表单
  const [genCount, setGenCount] = useState('10');
  const [genValidDays, setGenValidDays] = useState('30');
  const [genDailyLimit, setGenDailyLimit] = useState('20');
  const [genRemark, setGenRemark] = useState('');
  const [genLoading, setGenLoading] = useState(false);
  // 删除确认弹窗（待删的 unused 卡密列表）
  const [deleteTarget, setDeleteTarget] = useState<string[] | null>(null);
  // 续期弹窗（待续期的卡密 + 延长天数）
  const [renewCard, setRenewCard] = useState<CardRow | null>(null);
  const [renewDays, setRenewDays] = useState('30');
  const [renewLoading, setRenewLoading] = useState(false);

  const pageSize = 15;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (searchCode.trim()) params.set('code', searchCode.trim());
      if (filterStatus !== 'all') params.set('status', filterStatus);
      const res = await fetcher(`/api/admin/cards?${params}`);
      const data = await res.json();
      if (data.success) {
        setRows(data.items);
        setTotal(data.total);
      }
    } catch {
      toast.error('加载卡密列表失败');
    } finally {
      setLoading(false);
    }
  }, [fetcher, page, searchCode, filterStatus]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSetStatus = async (code: string, status: 'frozen' | 'revoked' | 'active') => {
    try {
      const res = await fetcher('/api/admin/cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, status }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`${code} 已${status === 'frozen' ? '冻结' : status === 'revoked' ? '作废' : '恢复'}`);
        load();
      } else {
        toast.error(data.error || '操作失败');
      }
    } catch {
      toast.error('网络错误');
    }
  };

  // 续期卡密（仅激活/已过期卡可续期，历史记录保留在原卡密下）
  const handleRenew = async () => {
    if (!renewCard) return;
    const days = parseInt(renewDays, 10);
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      toast.error('延长天数需在 1-365 之间');
      return;
    }
    setRenewLoading(true);
    try {
      const res = await fetcher('/api/admin/cards/renew', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardId: renewCard.id, addDays: days }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`${renewCard.code} 已续期 ${days} 天${data.expiresAt ? `，新到期日 ${String(data.expiresAt).slice(0, 10)}` : ''}`);
        setRenewCard(null);
        load();
      } else {
        toast.error(data.error || '续期失败');
      }
    } catch {
      toast.error('网络错误');
    } finally {
      setRenewLoading(false);
    }
  };

  // 删除卡密（仅 unused 未激活卡密可物理删除）
  const handleDeleteCards = async (codes: string[]) => {
    if (codes.length === 0) return;
    try {
      const res = await fetcher('/api/admin/cards', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codes }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(data.message || `已删除 ${data.deleted} 张卡密`);
        load();
      } else {
        toast.error(data.error || '删除失败');
      }
    } catch {
      toast.error('网络错误');
    }
  };

  const handleGenerate = async () => {
    const count = parseInt(genCount, 10);
    if (!Number.isFinite(count) || count < 1 || count > 500) {
      toast.error('生成数量需在 1-500 之间');
      return;
    }
    setGenLoading(true);
    try {
      const res = await fetcher('/api/admin/cards/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          count,
          validDays: parseInt(genValidDays, 10) || 30,
          dailyLimit: parseInt(genDailyLimit, 10) || 20,
          remark: genRemark.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setGenResult(data.cards.map((c: { code: string }) => c.code));
        toast.success(`成功生成 ${data.inserted} 张卡密`);
        load();
      } else {
        toast.error(data.error || '生成失败');
      }
    } catch {
      toast.error('网络错误');
    } finally {
      setGenLoading(false);
    }
  };

  const exportCSV = () => {
    if (!genResult) return;
    const csv = '卡密,状态,有效期(天),每日上限,备注\n' + genResult.map((c) => `${c},unused,${genValidDays},${genDailyLimit},${genRemark}`).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `卡密批量导出_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const totalPages = Math.max(Math.ceil(total / pageSize), 1);

  return (
    <div className="space-y-4">
      {/* 工具栏 */}
      <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索卡密..."
            value={searchCode}
            onChange={(e) => { setSearchCode(e.target.value); setPage(1); }}
            className="pl-9"
          />
        </div>
        <Select value={filterStatus} onValueChange={(v) => { setFilterStatus(v); setPage(1); }}>
          <SelectTrigger className="w-[130px]">
            <SelectValue placeholder="状态" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部状态</SelectItem>
            <SelectItem value="unused">未激活</SelectItem>
            <SelectItem value="active">已激活</SelectItem>
            <SelectItem value="frozen">已冻结</SelectItem>
            <SelectItem value="revoked">已作废</SelectItem>
            <SelectItem value="expired">已过期</SelectItem>
          </SelectContent>
        </Select>
        <Button onClick={() => setGenOpen(true)} className="gap-1.5 ml-auto">
          <Plus className="h-4 w-4" /> 批量生成卡密
        </Button>
        {rows.some((c) => c.status === 'unused') && (
          <Button
            variant="outline"
            className="gap-1.5 text-destructive hover:text-destructive"
            onClick={() => setDeleteTarget(rows.filter((c) => c.status === 'unused').map((c) => c.code))}
            title="删除当前页全部未激活卡密"
          >
            <Trash2 className="h-4 w-4" /> 删除本页未激活
          </Button>
        )}
      </div>

      {/* 表格 */}
      <div className="rounded-xl border border-border/60 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>卡密</TableHead>
              <TableHead className="w-20">状态</TableHead>
              <TableHead className="w-24">每日上限</TableHead>
              <TableHead className="w-28">激活时间</TableHead>
              <TableHead className="w-28">到期时间</TableHead>
              <TableHead className="hidden md:table-cell">备注</TableHead>
              <TableHead className="w-36 text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} className="py-12 text-center">
                  <Loader2 className="h-6 w-6 animate-spin text-primary mx-auto" />
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-12 text-center text-muted-foreground">
                  暂无卡密记录
                </TableCell>
              </TableRow>
            ) : (
              rows.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-mono text-xs font-semibold">
                    <span className="inline-flex items-center gap-1.5 group">
                      {c.code}
                      <button
                        className="rounded p-0.5 text-muted-foreground hover:text-primary transition-colors"
                        title="复制卡密"
                        onClick={() => {
                          navigator.clipboard.writeText(c.code);
                          toast.success('已复制：' + c.code);
                        }}
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  </TableCell>
                  <TableCell><StatusBadge status={c.status} /></TableCell>
                  <TableCell className="text-sm">{c.daily_limit} 次</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{c.activated_at?.slice(0, 16).replace('T', ' ') || '—'}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{c.expires_at?.slice(0, 10) || '—'}</TableCell>
                  <TableCell className="hidden md:table-cell text-xs text-muted-foreground max-w-[140px] truncate">{c.remark || '—'}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {(c.status === 'active' || c.status === 'expired') && (
                        <Button size="icon" variant="ghost" className="h-8 w-8 text-amber-600" title="续期" onClick={() => { setRenewCard(c); setRenewDays('30'); }}>
                          <CalendarClock className="h-4 w-4" />
                        </Button>
                      )}
                      {c.status === 'active' && (
                        <Button size="icon" variant="ghost" className="h-8 w-8 text-sky-600" title="冻结" onClick={() => handleSetStatus(c.code, 'frozen')}>
                          <Snowflake className="h-4 w-4" />
                        </Button>
                      )}
                      {(c.status === 'unused' || c.status === 'active' || c.status === 'frozen') && (
                        <Button size="icon" variant="ghost" className="h-8 w-8 text-rose-600" title="作废" onClick={() => handleSetStatus(c.code, 'revoked')}>
                          <Ban className="h-4 w-4" />
                        </Button>
                      )}
                      {c.status === 'frozen' && (
                        <Button size="icon" variant="ghost" className="h-8 w-8 text-emerald-600" title="恢复激活" onClick={() => handleSetStatus(c.code, 'active')}>
                          <PlayCircle className="h-4 w-4" />
                        </Button>
                      )}
                      {c.status === 'unused' && (
                        <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" title="删除（仅未激活卡密可删除）" onClick={() => setDeleteTarget([c.code])}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* 分页 */}
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>共 {total} 条 · 第 {page}/{totalPages} 页</span>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            <ChevronLeft className="h-4 w-4" /> 上一页
          </Button>
          <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            下一页 <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* 删除确认弹窗 */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除 {deleteTarget?.length} 张卡密？</AlertDialogTitle>
            <AlertDialogDescription>
              仅未激活卡密会被物理删除，删除后不可恢复。已激活/冻结/作废的卡密不会受影响（请使用冻结/作废管理）。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                const codes = deleteTarget;
                setDeleteTarget(null);
                if (codes) handleDeleteCards(codes);
              }}
            >
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 续期弹窗 */}
      <Dialog open={!!renewCard} onOpenChange={(open) => { if (!open) setRenewCard(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>卡密续期</DialogTitle>
            <DialogDescription>
              延长卡密使用期限，历史记录保留在原卡密下不丢失；已过期卡续期后自动恢复为已激活。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm text-muted-foreground">卡密</span>
              <span className="font-mono text-xs font-semibold break-all">{renewCard?.code}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm text-muted-foreground">当前状态</span>
              <StatusBadge status={renewCard?.status || ''} />
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm text-muted-foreground">原到期日</span>
              <span className="text-xs">{renewCard?.expires_at?.slice(0, 10) || '—'}</span>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">延长天数（1-365）</label>
              <Input type="number" min={1} max={365} value={renewDays} onChange={(e) => setRenewDays(e.target.value)} />
              <div className="flex flex-wrap gap-1 pt-0.5">
                {QUICK_VALID_OPTIONS.map((opt) => (
                  <button
                    key={opt.days}
                    type="button"
                    className={`rounded-full border px-2 py-0.5 text-xs transition-colors ${
                      renewDays === String(opt.days)
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border/60 bg-background text-muted-foreground hover:border-primary/50 hover:text-foreground'
                    }`}
                    onClick={() => setRenewDays(String(opt.days))}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenewCard(null)}>取消</Button>
            <Button onClick={handleRenew} disabled={renewLoading}>
              {renewLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              确认续期
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 生成弹窗 */}
      <Dialog open={genOpen} onOpenChange={(open) => { setGenOpen(open); if (!open) { setGenResult(null); setGenCopied(false); } }}>
        <DialogContent className="sm:max-w-lg">
          {!genResult ? (
            <>
              <DialogHeader>
                <DialogTitle>批量生成卡密</DialogTitle>
                <DialogDescription>卡密格式：SP- + 12位大写字母数字（自动排除易混淆字符和连续序列）</DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">数量</label>
                  <Input type="number" min={1} max={500} value={genCount} onChange={(e) => setGenCount(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">有效期(天)</label>
                  <Input type="number" min={1} value={genValidDays} onChange={(e) => setGenValidDays(e.target.value)} />
                  <div className="flex flex-wrap gap-1 pt-0.5">
                    {QUICK_VALID_OPTIONS.map((opt) => (
                      <button
                        key={opt.days}
                        type="button"
                        className={`rounded-full border px-2 py-0.5 text-xs transition-colors ${
                          genValidDays === String(opt.days)
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-border/60 bg-background text-muted-foreground hover:border-primary/50 hover:text-foreground'
                        }`}
                        onClick={() => setGenValidDays(String(opt.days))}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">每日上限</label>
                  <Input type="number" min={1} value={genDailyLimit} onChange={(e) => setGenDailyLimit(e.target.value)} />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">备注（可选）</label>
                <Input placeholder="如：双11活动专用" value={genRemark} onChange={(e) => setGenRemark(e.target.value)} />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setGenOpen(false)}>取消</Button>
                <Button onClick={handleGenerate} disabled={genLoading} className="gap-1.5">
                  {genLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  生成
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>生成成功（{genResult.length} 张）</DialogTitle>
                <DialogDescription>请立即复制或导出保存，关闭后仍可在列表中查询</DialogDescription>
              </DialogHeader>
              <div className="max-h-72 overflow-auto rounded-lg border border-border/60 bg-slate-50 p-3 font-mono text-xs space-y-1">
                {genResult.map((c) => (
                  <div key={c} className="flex items-center justify-between gap-2 group">
                    <span>{c}</span>
                    <button
                      className="shrink-0 rounded p-1 text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-white hover:text-primary transition-opacity"
                      title="复制此卡密"
                      onClick={() => {
                        navigator.clipboard.writeText(c);
                        toast.success('已复制：' + c);
                      }}
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
              <DialogFooter>
                <Button variant="outline" className="gap-1.5" onClick={() => {
                  navigator.clipboard.writeText(genResult.join('\n'));
                  setGenCopied(true);
                  toast.success('已复制全部卡密');
                }}>
                  {genCopied ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                  复制全部
                </Button>
                <Button variant="outline" className="gap-1.5" onClick={exportCSV}>
                  <Download className="h-4 w-4" /> 导出CSV
                </Button>
                <Button onClick={() => { setGenOpen(false); setGenResult(null); }}>完成</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ========= Tab 2: 使用日志 =========
interface LogRow {
  id: number;
  card_code: string;
  action: string;
  success: number;
  ip: string | null;
  detail: string | null;
  created_at: string;
}

const ACTION_LABELS: Record<string, string> = {
  verify: '卡密验证',
  storyboard: '生成分镜',
  titles: '生成标题',
  polish: '文案润色',
  character_views: '角色三视图',
  admin_generate_cards: '管理员发卡',
  admin_set_status: '卡密状态变更',
  admin_login: '管理员登录',
};

function LogsPanel({ fetcher }: { fetcher: AdminFetcher }) {
  const [rows, setRows] = useState<LogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [searchCode, setSearchCode] = useState('');
  const [filterAction, setFilterAction] = useState('all');
  const [loading, setLoading] = useState(true);
  // 日志清理确认弹窗：null 关闭 / 0 清空全部 / N 保留最近 N 天
  const [cleanTarget, setCleanTarget] = useState<number | null>(null);

  const pageSize = 20;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (searchCode.trim()) params.set('cardCode', searchCode.trim());
      if (filterAction !== 'all') params.set('action', filterAction);
      const res = await fetcher(`/api/admin/logs?${params}`);
      const data = await res.json();
      if (data.success) {
        setRows(data.items);
        setTotal(data.total);
      }
    } catch {
      toast.error('加载日志失败');
    } finally {
      setLoading(false);
    }
  }, [fetcher, page, searchCode, filterAction]);

  useEffect(() => {
    load();
  }, [load]);

  const totalPages = Math.max(Math.ceil(total / pageSize), 1);

  // 清理日志（0=清空全部 / N=保留最近 N 天）
  const handleClean = async (keepDays: number) => {
    try {
      const url = keepDays > 0 ? `/api/admin/logs?keepDays=${keepDays}` : '/api/admin/logs';
      const res = await fetcher(url, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        toast.success(`已清理 ${data.deleted} 条日志`);
        setPage(1);
        load();
      } else {
        toast.error(data.error || '清理失败');
      }
    } catch {
      toast.error('网络错误');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="按卡密搜索..."
            value={searchCode}
            onChange={(e) => { setSearchCode(e.target.value); setPage(1); }}
            className="pl-9"
          />
        </div>
        <Select value={filterAction} onValueChange={(v) => { setFilterAction(v); setPage(1); }}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="操作类型" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部操作</SelectItem>
            <SelectItem value="verify">卡密验证</SelectItem>
            <SelectItem value="storyboard">生成分镜</SelectItem>
            <SelectItem value="titles">生成标题</SelectItem>
            <SelectItem value="polish">文案润色</SelectItem>
            <SelectItem value="character_views">角色三视图</SelectItem>
            <SelectItem value="admin_generate_cards">管理员发卡</SelectItem>
            <SelectItem value="admin_set_status">状态变更</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" className="gap-1.5 ml-auto self-start" onClick={load}>
          <RefreshCw className="h-4 w-4" /> 刷新
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 text-destructive hover:text-destructive self-start"
          onClick={() => setCleanTarget(30)}
          title="保留最近30天日志，清理更早的"
        >
          <Trash2 className="h-4 w-4" /> 清理30天前
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 text-destructive hover:text-destructive self-start"
          onClick={() => setCleanTarget(0)}
          disabled={total === 0}
        >
          <Trash2 className="h-4 w-4" /> 清空全部
        </Button>
      </div>

      <div className="rounded-xl border border-border/60 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-36">时间</TableHead>
              <TableHead className="w-36">卡密</TableHead>
              <TableHead className="w-28">操作</TableHead>
              <TableHead className="w-16">结果</TableHead>
              <TableHead className="w-28">IP</TableHead>
              <TableHead className="hidden md:table-cell">详情</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} className="py-12 text-center">
                  <Loader2 className="h-6 w-6 animate-spin text-primary mx-auto" />
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-12 text-center text-muted-foreground">暂无日志</TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{r.created_at?.slice(0, 19).replace('T', ' ')}</TableCell>
                  <TableCell className="font-mono text-xs">{r.card_code}</TableCell>
                  <TableCell className="text-sm">{ACTION_LABELS[r.action] || r.action}</TableCell>
                  <TableCell>
                    {r.success ? (
                      <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">成功</Badge>
                    ) : (
                      <Badge variant="outline" className="bg-rose-50 text-rose-700 border-rose-200">失败</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground font-mono">{r.ip || '—'}</TableCell>
                  <TableCell className="hidden md:table-cell text-xs text-muted-foreground max-w-[200px] truncate" title={r.detail || ''}>
                    {r.detail || '—'}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>共 {total} 条 · 第 {page}/{totalPages} 页</span>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            <ChevronLeft className="h-4 w-4" /> 上一页
          </Button>
          <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            下一页 <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* 清理确认弹窗 */}
      <AlertDialog open={cleanTarget !== null} onOpenChange={(open) => { if (!open) setCleanTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {cleanTarget === 0 ? '确认清空全部日志？' : `确认清理 ${cleanTarget} 天前的日志？`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {cleanTarget === 0
                ? `将删除全部 ${total} 条使用日志，删除后不可恢复。`
                : `将删除 ${cleanTarget} 天前的使用日志（保留最近 ${cleanTarget} 天），删除后不可恢复。`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                const keepDays = cleanTarget;
                setCleanTarget(null);
                if (keepDays !== null) handleClean(keepDays);
              }}
            >
              确认清理
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ========= Tab 3: 系统配置 =========
interface ModelOption {
  id: string;
  label: string;
}

interface ProviderInfo {
  key: string;
  label: string;
  defaultModel: string;
  currentModel: string;
  modelCustom: boolean;
  models: ModelOption[];
  configured: boolean;
  configuredFrom: string;
  enabled: boolean;
}

interface ConfigData {
  defaultProvider: string;
  dailyLimit: number;
  qpsLimit: number;
  tierAccess: string;
  exhaustedTip?: string;
}

/** 运行护栏（紧急暂停 + 全局每日上限） */
interface GuardConfig {
  servicePaused: boolean;
  globalDailyLimit: number;
}

// 模型选择器：预设下拉（含价格档位）+ 自定义输入兜底
function ModelSelector({
  provider,
  fetcher,
  onSaved,
}: {
  provider: ProviderInfo;
  fetcher: AdminFetcher;
  onSaved: () => void;
}) {
  const isInCatalog = provider.models.some((m) => m.id === provider.currentModel);
  // 状态：preset（下拉选择）/ custom（自定义输入）
  const [mode, setMode] = useState<'preset' | 'custom'>(isInCatalog ? 'preset' : 'custom');
  const [selected, setSelected] = useState(isInCatalog ? provider.currentModel : provider.models[0]?.id || '');
  const [custom, setCustom] = useState(isInCatalog ? '' : provider.currentModel);
  const [saving, setSaving] = useState(false);

  // 切换到其他服务商时重置（组件复用）
  useEffect(() => {
    const inCat = provider.models.some((m) => m.id === provider.currentModel);
    setMode(inCat ? 'preset' : 'custom');
    setSelected(inCat ? provider.currentModel : provider.models[0]?.id || '');
    setCustom(inCat ? '' : provider.currentModel);
  }, [provider.key, provider.currentModel, provider.models]);

  const targetModel = mode === 'preset' ? selected : custom.trim();

  const handleSave = async () => {
    if (!targetModel) {
      toast.error('请选择或输入模型名');
      return;
    }
    setSaving(true);
    try {
      const res = await fetcher('/api/admin/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json',  },
        body: JSON.stringify({ [`ai_model_${provider.key}`]: targetModel }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`${provider.label} 模型已切换为 ${targetModel}`);
        onSaved();
      } else {
        toast.error(data.error || '保存失败');
      }
    } catch {
      toast.error('网络错误');
    } finally {
      setSaving(false);
    }
  };

  const handleResetDefault = async () => {
    setSaving(true);
    try {
      const res = await fetcher('/api/admin/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json',  },
        body: JSON.stringify({ [`ai_model_${provider.key}`]: provider.defaultModel }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`已恢复默认模型 ${provider.defaultModel}`);
        onSaved();
      } else {
        toast.error(data.error || '操作失败');
      }
    } catch {
      toast.error('网络错误');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-muted-foreground">大模型</label>
        <div className="flex gap-1 text-xs">
          <button
            className={`rounded px-2 py-0.5 transition-colors ${mode === 'preset' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}
            onClick={() => setMode('preset')}
          >
            常用模型
          </button>
          <button
            className={`rounded px-2 py-0.5 transition-colors ${mode === 'custom' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}
            onClick={() => setMode('custom')}
          >
            自定义
          </button>
        </div>
      </div>
      <div className="flex gap-2">
        {mode === 'preset' ? (
          <Select value={selected} onValueChange={setSelected}>
            <SelectTrigger className="flex-1">
              <SelectValue placeholder="选择模型" />
            </SelectTrigger>
            <SelectContent>
              {provider.models.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input
            placeholder="填入模型名（如 doubao 接入点ID、新发布的模型）"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            className="flex-1 font-mono text-xs"
          />
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={handleSave}
          disabled={saving || !targetModel || targetModel === provider.currentModel}
          className="gap-1.5 shrink-0"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Cpu className="h-4 w-4" />}
          切换模型
        </Button>
        {provider.currentModel !== provider.defaultModel && (
          <Button variant="ghost" size="sm" onClick={handleResetDefault} disabled={saving} className="shrink-0 text-xs">
            恢复默认
          </Button>
        )}
      </div>
    </div>
  );
}

function ConfigPanel({ fetcher }: { fetcher: AdminFetcher }) {
  const [config, setConfig] = useState<ConfigData | null>(null);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({});
  // 清除配置确认弹窗（待清除的服务商）
  const [clearTarget, setClearTarget] = useState<ProviderInfo | null>(null);
  // JWT 密钥安全状态（true = 仍在用开发默认值）
  const [usingFallbackJwtSecret, setUsingFallbackJwtSecret] = useState(false);
  // API Key 加密存储是否生效（未配置 CONFIG_ENCRYPTION_KEY 时为 false）
  const [apiKeyEncrypted, setApiKeyEncrypted] = useState(true);
  // 运行护栏
  const [guard, setGuard] = useState<GuardConfig>({ servicePaused: false, globalDailyLimit: 0 });
  const [guardSaving, setGuardSaving] = useState(false);
  // 次数用尽引导文案
  const [exhaustedTip, setExhaustedTip] = useState('');
  const [tipSaving, setTipSaving] = useState(false);
  // 全站顶部公告
  const [noticeEnabled, setNoticeEnabled] = useState(false);
  const [noticeContent, setNoticeContent] = useState('');
  const [noticeLink, setNoticeLink] = useState('');
  const [noticeType, setNoticeType] = useState<'info' | 'warning' | 'danger'>('info');
  const [noticeSaving, setNoticeSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetcher('/api/admin/config');
      const data = await res.json();
      if (data.success) {
        setConfig(data.config);
        setProviders(data.providers || []);
        setUsingFallbackJwtSecret(!!data.security?.usingFallbackJwtSecret);
        setApiKeyEncrypted(data.security?.apiKeyEncrypted !== false);
        if (data.guard) setGuard(data.guard);
        setExhaustedTip(data.exhaustedTip || '');
        if (data.notice) {
          setNoticeEnabled(!!data.notice.enabled);
          setNoticeContent(data.notice.content || '');
          setNoticeLink(data.notice.link || '');
          setNoticeType(data.notice.type || 'info');
        }
      }
    } catch {
      toast.error('加载配置失败');
    } finally {
      setLoading(false);
    }
  }, [fetcher]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    try {
      const res = await fetcher('/api/admin/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          default_provider: config.defaultProvider,
          daily_limit: String(config.dailyLimit),
          qps_limit: String(config.qpsLimit),
          tier_access: config.tierAccess || 'all',
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success('基础配置已保存');
      } else {
        toast.error(data.error || '保存失败');
      }
    } catch {
      toast.error('网络错误');
    } finally {
      setSaving(false);
    }
  };

  // 保存运行护栏（暂停开关 + 全局每日上限）
  const handleSaveGuard = async (patch: Partial<GuardConfig>) => {
    const next = { ...guard, ...patch };
    setGuardSaving(true);
    try {
      const res = await fetcher('/api/admin/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service_paused: next.servicePaused ? '1' : '0',
          global_daily_limit: String(next.globalDailyLimit),
        }),
      });
      const data = await res.json();
      if (data.success) {
        setGuard(next);
        toast.success(next.servicePaused ? '已紧急暂停所有生成服务' : '运行护栏已保存');
      } else {
        toast.error(data.error || '保存失败');
      }
    } catch {
      toast.error('网络错误');
    } finally {
      setGuardSaving(false);
    }
  };

  // 保存次数用尽引导文案
  const handleSaveTip = async () => {
    setTipSaving(true);
    try {
      const res = await fetcher('/api/admin/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exhausted_tip: exhaustedTip.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success('引导文案已保存');
      } else {
        toast.error(data.error || '保存失败');
      }
    } catch {
      toast.error('网络错误');
    } finally {
      setTipSaving(false);
    }
  };

  // 保存全站顶部公告
  const handleSaveNotice = async () => {
    if (noticeEnabled && !noticeContent.trim()) {
      toast.error('启用公告时必须填写公告内容');
      return;
    }
    setNoticeSaving(true);
    try {
      const res = await fetcher('/api/admin/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notice_enabled: noticeEnabled ? '1' : '0',
          notice_content: noticeContent.trim(),
          notice_link: noticeLink.trim(),
          notice_type: noticeType,
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(noticeEnabled ? '公告已发布' : '公告已关闭');
      } else {
        toast.error(data.error || '保存失败');
      }
    } catch {
      toast.error('网络错误');
    } finally {
      setNoticeSaving(false);
    }
  };

  const handleSaveKey = async (providerKey: string) => {
    const key = (keyDrafts[providerKey] || '').trim();
    if (!key) {
      toast.error('请先输入 API Key');
      return;
    }
    try {
      const res = await fetcher('/api/admin/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [`ai_key_${providerKey}`]: key }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(apiKeyEncrypted
          ? 'API Key 已加密存储（AES-256-GCM）'
          : 'API Key 已保存（明文存储，配置 CONFIG_ENCRYPTION_KEY 环境变量后自动加密）');
        setKeyDrafts((d) => ({ ...d, [providerKey]: '' }));
        load();
      } else {
        toast.error(data.error || '保存失败');
      }
    } catch {
      toast.error('网络错误');
    }
  };

  // 清除某家服务商的全部配置（Key + 模型覆盖），即停用该服务商
  const handleClearProvider = async (provider: ProviderInfo) => {
    try {
      const res = await fetcher('/api/admin/config', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json',  },
        body: JSON.stringify({ provider: provider.key }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`${provider.label} 配置已清除（已停用）`);
        setKeyDrafts((d) => ({ ...d, [provider.key]: '' }));
        load();
      } else {
        toast.error(data.error || '操作失败');
      }
    } catch {
      toast.error('网络错误');
    }
  };

  // 启用/停用单家服务商（停用后用户端下拉不再展示，调用与回退自动跳过）
  const [togglingKey, setTogglingKey] = useState<string | null>(null);
  const handleToggleEnabled = async (provider: ProviderInfo) => {
    setTogglingKey(provider.key);
    try {
      const res = await fetcher('/api/admin/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json',  },
        body: JSON.stringify({ [`ai_enabled_${provider.key}`]: provider.enabled ? '0' : '1' }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(provider.enabled ? `${provider.label} 已停用` : `${provider.label} 已启用`);
        load();
      } else {
        toast.error(data.error || '操作失败');
      }
    } catch {
      toast.error('网络错误');
    } finally {
      setTogglingKey(null);
    }
  };

  if (loading) {
    return (
      <div className="py-20 text-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* JWT 密钥安全提醒（开发默认密钥仅允许本地调试；生产环境服务端会拒绝启动） */}
      {usingFallbackJwtSecret && (
        <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            当前 JWT 密钥使用开发默认值，存在伪造登录令牌风险。部署生产环境前请通过环境变量
            <code className="mx-1 rounded bg-amber-100 px-1 py-0.5 text-xs">JWT_SECRET</code>
            注入强随机密钥（如 <code className="rounded bg-amber-100 px-1 py-0.5 text-xs">openssl rand -hex 32</code> 生成）。生产模式下未配置将拒绝启动。
          </span>
        </div>
      )}
      {/* API Key 明文存储提醒（未配置加密主密钥时） */}
      {!apiKeyEncrypted && (
        <div className="flex items-start gap-2.5 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            在后台填写的 AI API Key 当前以明文存储于数据库。建议配置环境变量
            <code className="mx-1 rounded bg-sky-100 px-1 py-0.5 text-xs">CONFIG_ENCRYPTION_KEY</code>
            （<code className="rounded bg-sky-100 px-1 py-0.5 text-xs">openssl rand -hex 32</code> 生成）启用 AES-256-GCM 加密存储，配置后重新保存 Key 即可加密；生产环境也可仅用环境变量注入 Key。
          </span>
        </div>
      )}
      {/* 基础配置 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Settings className="h-5 w-5 text-primary" /> 基础配置
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid sm:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">默认 AI 服务商</label>
              <Select value={config!.defaultProvider} onValueChange={(v) => setConfig({ ...config!, defaultProvider: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {providers.map((p) => (
                    <SelectItem key={p.key} value={p.key}>
                      {p.label} {p.configured ? '✓' : '（未配置）'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">每日生成上限（次）</label>
              <Input
                type="number"
                min={1}
                max={1000}
                value={config!.dailyLimit}
                onChange={(e) => setConfig({ ...config!, dailyLimit: parseInt(e.target.value, 10) || 20 })}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">全局 QPS 上限</label>
              <Input
                type="number"
                min={1}
                max={500}
                value={config!.qpsLimit}
                onChange={(e) => setConfig({ ...config!, qpsLimit: parseInt(e.target.value, 10) || 10 })}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">用户端开放档位</label>
              <Select value={config!.tierAccess || 'all'} onValueChange={(v) => setConfig({ ...config!, tierAccess: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部档位（含👑旗舰版·3次）</SelectItem>
                  <SelectItem value="plus">到💎高质量版（2次）</SelectItem>
                  <SelectItem value="standard">到💎标准版（1次）</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">收窄后用户端模型选择器将隐藏更高档位</p>
            </div>
          </div>
          <Button onClick={handleSave} disabled={saving} className="gap-1.5">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            保存基础配置
          </Button>
        </CardContent>
      </Card>

      {/* 运行护栏：紧急暂停 + 全局每日上限（止损用） */}
      <Card className={guard.servicePaused ? 'border-destructive/40' : undefined}>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <ShieldAlert className={`h-5 w-5 ${guard.servicePaused ? 'text-destructive' : 'text-amber-500'}`} />
            运行护栏（止损保护）
            {guard.servicePaused && (
              <Badge variant="outline" className="bg-rose-50 text-rose-700 border-rose-200">
                已暂停
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            紧急情况（如 Key 泄露、恶意刷量）可一键暂停所有生成；全局每日上限按全站成功生成次数合计计算，0 为不限制
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium">紧急暂停生成服务</div>
              <div className="text-xs text-muted-foreground">暂停后用户端所有生成请求立即返回“系统维护中”，不消耗任何次数</div>
            </div>
            <Button
              variant={guard.servicePaused ? 'default' : 'destructive'}
              disabled={guardSaving}
              className="gap-1.5 shrink-0"
              onClick={() => {
                setGuardSaving(true);
                handleSaveGuard({ servicePaused: !guard.servicePaused });
              }}
            >
              {guardSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />}
              {guard.servicePaused ? '恢复服务' : '紧急暂停'}
            </Button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium">全局每日生成上限</div>
              <div className="text-xs text-muted-foreground">全站所有卡密当日成功生成次数合计达到该值后，当日停止服务（防止 API 账单失控）</div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Input
                type="number"
                min={0}
                max={1000000}
                className="w-28"
                value={guard.globalDailyLimit}
                onChange={(e) => setGuard((g) => ({ ...g, globalDailyLimit: parseInt(e.target.value, 10) || 0 }))}
              />
              <Button variant="outline" disabled={guardSaving} onClick={() => handleSaveGuard({})} className="gap-1.5">
                {guardSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                保存
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 次数用尽引导文案 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <MessageCircle className="h-5 w-5 text-sky-500" /> 次数用尽引导文案
          </CardTitle>
          <CardDescription>
            用户当日生成次数用完时，在错误提示后展示的引导内容（如加微信续费、明日再来等）；留空则不展示
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            placeholder="例如：想继续生成？添加客服微信 xxxxxx 获取新卡密，或明天再来免费使用～"
            value={exhaustedTip}
            onChange={(e) => setExhaustedTip(e.target.value.slice(0, 200))}
            className="min-h-[80px] resize-y text-sm"
          />
          <div className="flex items-center justify-between">
            <span className={`text-xs ${exhaustedTip.length > 190 ? 'text-destructive font-medium' : 'text-muted-foreground'}`}>
              {exhaustedTip.length}/200 字
            </span>
            <Button onClick={handleSaveTip} disabled={tipSaving} className="gap-1.5">
              {tipSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              保存文案
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 全站顶部公告 */}
      <Card className={noticeEnabled ? 'border-amber-400/50' : undefined}>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <MessageCircle className={`h-5 w-5 ${noticeEnabled ? 'text-amber-500' : 'text-muted-foreground'}`} />
            全站顶部公告
            {noticeEnabled && <Badge variant="secondary" className="text-xs font-normal">已发布</Badge>}
          </CardTitle>
          <CardDescription>
            在用户端所有页面顶部展示一条可关闭的公告栏（如域名迁移、内测通知等）；关闭开关即可隐藏
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border border-border/60 p-3">
            <div className="space-y-0.5">
              <div className="text-sm font-medium">启用公告</div>
              <div className="text-xs text-muted-foreground">开启后立即在用户端生效</div>
            </div>
            <Switch checked={noticeEnabled} onCheckedChange={setNoticeEnabled} />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">公告内容</label>
            <Textarea
              placeholder="例如：⚠️ 域名迁移通知：请访问 xxx.com 继续使用，旧域名即将下线"
              value={noticeContent}
              onChange={(e) => setNoticeContent(e.target.value.slice(0, 300))}
              className="min-h-[80px] resize-y text-sm"
            />
            <div className="flex justify-between">
              <span className={`text-xs ${noticeContent.length > 280 ? 'text-destructive font-medium' : 'text-muted-foreground'}`}>
                {noticeContent.length}/300 字
              </span>
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">跳转链接（可选）</label>
            <Input
              placeholder="https://..."
              value={noticeLink}
              onChange={(e) => setNoticeLink(e.target.value)}
              className="text-sm"
            />
            <span className="text-xs text-muted-foreground">填写后公告栏会显示"前往"按钮，点击跳转到该链接</span>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">样式类型</label>
            <div className="flex gap-2">
              {(['info', 'warning', 'danger'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                    noticeType === t
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border/60 bg-background text-muted-foreground hover:border-primary/50'
                  }`}
                  onClick={() => setNoticeType(t)}
                >
                  {t === 'info' ? 'ℹ️ 信息（蓝）' : t === 'warning' ? '⚠️ 警告（黄）' : '🚨 紧急（红）'}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between">
            <div className="text-xs text-muted-foreground">
              预览：
              <span className={`ml-2 rounded px-2 py-0.5 text-xs ${
                noticeType === 'info' ? 'bg-sky-50 text-sky-700 border border-sky-200' :
                noticeType === 'warning' ? 'bg-amber-50 text-amber-700 border border-amber-200' :
                'bg-rose-50 text-rose-700 border border-rose-200'
              }`}>
                {noticeContent || '公告内容预览'}
              </span>
            </div>
            <Button onClick={handleSaveNotice} disabled={noticeSaving} className="gap-1.5">
              {noticeSaving && <Loader2 className="h-4 w-4 animate-spin" />}
              {noticeEnabled ? '发布公告' : '保存设置'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* AI 服务商配置 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Cpu className="h-5 w-5 text-fuchsia-500" /> AI 服务商（OpenAI 兼容格式）
          </CardTitle>
          <CardDescription>
            每家填入对应平台的 API Key 即可启用；模型可下拉切换（标注价格档位），切换后立即生效
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {providers.map((p) => (
            <div
              key={p.key}
              className={`rounded-xl border border-border/60 p-4 transition-opacity ${p.enabled ? '' : 'opacity-55'}`}
            >
              <div className="flex flex-wrap items-center gap-3 mb-3">
                <span className="font-semibold text-sm">{p.label}</span>
                {p.configured ? (
                  <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 gap-1">
                    <CheckCircle2 className="h-3 w-3" /> {p.configuredFrom}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="bg-slate-50 text-slate-500 border-slate-200 gap-1">
                    <KeyRound className="h-3 w-3" /> 未配置
                  </Badge>
                )}
                {!p.enabled && (
                  <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
                    已停用
                  </Badge>
                )}
                <span className="text-xs text-muted-foreground ml-auto font-mono">当前模型：{p.currentModel}</span>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">{p.enabled ? '启用' : '停用'}</span>
                  <Switch
                    checked={p.enabled}
                    disabled={togglingKey === p.key}
                    onCheckedChange={() => handleToggleEnabled(p)}
                    title="停用后：用户端下拉不再展示该服务商，AI 调用与自动回退均跳过它"
                  />
                </div>
                {p.configuredFrom === '后台配置' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                    onClick={() => setClearTarget(p)}
                    title="清除该服务商的 Key 与模型配置（即停用）"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> 清除配置
                  </Button>
                )}
              </div>
              <div className="flex gap-2 mb-2">
                <Input
                  type="password"
                  placeholder={p.configured ? '已配置（输入可覆盖）' : `填入 ${p.label} API Key`}
                  value={keyDrafts[p.key] || ''}
                  onChange={(e) => setKeyDrafts((d) => ({ ...d, [p.key]: e.target.value }))}
                />
                <Button variant="outline" onClick={() => handleSaveKey(p.key)} disabled={!keyDrafts[p.key]?.trim()} className="gap-1.5 shrink-0">
                  <KeyRound className="h-4 w-4" /> 保存Key
                </Button>
              </div>
              <ModelSelector provider={p} fetcher={fetcher} onSaved={load} />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* 清除服务商配置确认弹窗 */}
      <AlertDialog open={!!clearTarget} onOpenChange={(open) => { if (!open) setClearTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认清除 {clearTarget?.label} 的配置？</AlertDialogTitle>
            <AlertDialogDescription>
              将删除该服务商的 API Key 与模型配置，清除后立即停用：用户端模型选择器将不再显示它。
              {clearTarget && config?.defaultProvider === clearTarget.key
                ? ' 该服务商当前是默认服务商，清除后系统将自动切换到其他已配置的服务商，不会中断服务。'
                : ''}
              重新粘贴 Key 即可恢复启用。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                const target = clearTarget;
                setClearTarget(null);
                if (target) handleClearProvider(target);
              }}
            >
              确认清除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ========= 后台主界面 =========
interface StatsData {
  cardsTotal: number;
  activeCards: number;
  logsTotal: number;
  todayGen: number;
  todayCost: number;
  trend7d: Array<{ day: string; count: number; cost: number }>;
  tierRatio: Array<{ cost: number; count: number }>;
  remarkStats: Array<{
    remark: string;
    total: number;
    unused: number;
    active: number;
    frozen: number;
    revoked: number;
    expired: number;
  }>;
}

// 档位消耗分桶展示（cost = 单次消耗次数）
const TIER_BUCKET_META: Record<number, { label: string; barCls: string }> = {
  1: { label: '⚡ 极速/标准版（1次）', barCls: 'bg-emerald-500' },
  2: { label: '💎 高质量版（2次）', barCls: 'bg-sky-500' },
  3: { label: '👑 旗舰版（3次）', barCls: 'bg-amber-500' },
};

function AdminDashboard({ fetcher, onLogout }: { fetcher: AdminFetcher; onLogout: () => void }) {
  const [tab, setTab] = useState<'cards' | 'logs' | 'config' | 'feedback' | 'maintain'>('cards');
  const [stats, setStats] = useState<StatsData | null>(null);

  const loadStats = useCallback(async () => {
    try {
      const res = await fetcher('/api/admin/stats');
      const data = await res.json();
      if (data.success) {
        setStats({
          cardsTotal: data.cardsTotal,
          activeCards: data.activeCards,
          logsTotal: data.logsTotal,
          todayGen: data.todayGen,
          todayCost: data.todayCost,
          trend7d: data.trend7d || [],
          tierRatio: data.tierRatio || [],
          remarkStats: data.remarkStats || [],
        });
      }
    } catch {
      // 静默失败，看板显示 —
    }
  }, [fetcher]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const tabs = [
    { key: 'cards' as const, label: '卡密管理', icon: CreditCard },
    { key: 'logs' as const, label: '使用日志', icon: ScrollText },
    { key: 'config' as const, label: '系统配置', icon: Settings },
    { key: 'feedback' as const, label: '用户反馈', icon: MessageCircle },
    { key: 'maintain' as const, label: '数据维护', icon: Database },
  ];

  const trendMax = Math.max(1, ...(stats?.trend7d || []).map((t) => t.count));
  const tierTotal = (stats?.tierRatio || []).reduce((s, t) => s + t.count, 0);

  return (
    <div className="space-y-6">
      {/* 运营看板：核心指标 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-border/60">
          <CardHeader className="pb-2">
            <CardDescription>卡密总数 / 激活中</CardDescription>
            <CardTitle className="text-3xl font-bold text-primary">
              {stats ? stats.cardsTotal : '—'}
              <span className="text-base font-medium text-muted-foreground ml-1.5">/ {stats ? stats.activeCards : '—'}</span>
            </CardTitle>
          </CardHeader>
        </Card>
        <Card className="border-border/60">
          <CardHeader className="pb-2">
            <CardDescription>今日生成次数</CardDescription>
            <CardTitle className="text-3xl font-bold text-fuchsia-500">{stats ? stats.todayGen : '—'}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="border-border/60">
          <CardHeader className="pb-2">
            <CardDescription>今日消耗额度</CardDescription>
            <CardTitle className="text-3xl font-bold text-amber-500">{stats ? stats.todayCost : '—'}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="border-border/60">
          <CardHeader className="pb-2">
            <CardDescription>使用日志总数</CardDescription>
            <CardTitle className="text-3xl font-bold text-sky-500">{stats ? stats.logsTotal : '—'}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* 趋势 + 档位占比 */}
      <div className="grid lg:grid-cols-5 gap-4">
        <Card className="lg:col-span-3 border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">近 7 天生成趋势</CardTitle>
            <CardDescription>按日成功生成次数（标题 + 分镜）</CardDescription>
          </CardHeader>
          <CardContent>
            {stats && stats.trend7d.length > 0 ? (
              <div className="flex items-end justify-between gap-2 h-36 pt-2">
                {stats.trend7d.map((t) => (
                  <div key={t.day} className="flex-1 flex flex-col items-center gap-1.5 min-w-0">
                    <span className="text-xs font-medium text-foreground/80">{t.count}</span>
                    <div className="w-full max-w-10 bg-muted rounded-t-md overflow-hidden flex items-end h-20">
                      <div
                        className="w-full bg-gradient-to-t from-primary/70 to-primary rounded-t-md transition-all"
                        style={{ height: `${Math.max(t.count > 0 ? 8 : 2, Math.round((t.count / trendMax) * 100))}%` }}
                        title={`${t.day}：${t.count} 次 / 消耗 ${t.cost}`}
                      />
                    </div>
                    <span className="text-[10px] text-muted-foreground whitespace-nowrap">{t.day.slice(5)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">暂无数据</p>
            )}
          </CardContent>
        </Card>
        <Card className="lg:col-span-2 border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">档位消耗占比（近 7 天）</CardTitle>
            <CardDescription>按单次消耗次数分桶的生成次数占比</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {stats && stats.tierRatio.length > 0 ? (
              stats.tierRatio.map((t) => {
                const meta = TIER_BUCKET_META[t.cost] || { label: `${t.cost} 次档`, barCls: 'bg-slate-400' };
                const pct = tierTotal > 0 ? Math.round((t.count / tierTotal) * 100) : 0;
                return (
                  <div key={t.cost} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium">{meta.label}</span>
                      <span className="text-muted-foreground">{t.count} 次 · {pct}%</span>
                    </div>
                    <div className="h-2.5 rounded-full bg-muted overflow-hidden">
                      <div className={`h-full rounded-full ${meta.barCls}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">暂无数据</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 渠道/批次统计（按备注分组） */}
      {stats && stats.remarkStats.length > 0 && (
        <Card className="border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-primary" />
              渠道 / 批次统计（按备注分组）
            </CardTitle>
            <CardDescription>生成卡密时填写的备注可作为渠道/批次标识，此处按备注汇总各状态数量</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-xl border border-border/60 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>备注（渠道/批次）</TableHead>
                    <TableHead className="text-right">总数</TableHead>
                    <TableHead className="text-right">未激活</TableHead>
                    <TableHead className="text-right">激活中</TableHead>
                    <TableHead className="text-right">已冻结</TableHead>
                    <TableHead className="text-right">已作废</TableHead>
                    <TableHead className="text-right">已过期</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stats.remarkStats.map((r) => (
                    <TableRow key={r.remark}>
                      <TableCell className="font-medium max-w-[220px] truncate" title={r.remark}>{r.remark}</TableCell>
                      <TableCell className="text-right font-bold text-primary">{r.total}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{r.unused}</TableCell>
                      <TableCell className="text-right text-emerald-600">{r.active}</TableCell>
                      <TableCell className="text-right text-sky-600">{r.frozen}</TableCell>
                      <TableCell className="text-right text-rose-600">{r.revoked}</TableCell>
                      <TableCell className="text-right text-amber-600">{r.expired}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 功能 Tab */}
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {tabs.map((t) => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors ${
                active
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'cards' && <CardsPanel fetcher={fetcher} />}
      {tab === 'logs' && <LogsPanel fetcher={fetcher} />}
      {tab === 'config' && <ConfigPanel fetcher={fetcher} />}
      {tab === 'feedback' && <FeedbackPanel fetcher={fetcher} />}
      {tab === 'maintain' && <MaintenancePanel fetcher={fetcher} />}
    </div>
  );
}

// ========= 修改密码弹窗 =========
function ChangePasswordDialog({
  fetcher,
  open,
  onOpenChange,
  onChanged,
}: {
  fetcher: AdminFetcher;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const [oldPwd, setOldPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [loading, setLoading] = useState(false);

  const reset = () => {
    setOldPwd('');
    setNewPwd('');
    setConfirmPwd('');
    setLoading(false);
  };

  const handleSubmit = async () => {
    if (!oldPwd || !newPwd || !confirmPwd) {
      toast.error('请填写完整');
      return;
    }
    if (newPwd !== confirmPwd) {
      toast.error('两次输入的新密码不一致');
      return;
    }
    if (newPwd.length < 8 || !/[a-zA-Z]/.test(newPwd) || !/\d/.test(newPwd)) {
      toast.error('新密码需至少8位，且同时包含字母和数字');
      return;
    }
    setLoading(true);
    try {
      const res = await fetcher('/api/admin/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPassword: oldPwd, newPassword: newPwd }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success('密码已修改，请重新登录');
        reset();
        onOpenChange(false);
        onChanged();
      } else {
        toast.error(data.error || '修改失败');
      }
    } catch {
      toast.error('网络错误');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>修改管理员密码</DialogTitle>
          <DialogDescription>新密码需至少8位，且同时包含字母和数字；修改成功后需重新登录</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">旧密码</label>
            <Input type="password" value={oldPwd} onChange={(e) => setOldPwd(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">新密码</label>
            <Input type="password" value={newPwd} onChange={(e) => setNewPwd(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">确认新密码</label>
            <Input
              type="password"
              value={confirmPwd}
              onChange={(e) => setConfirmPwd(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={handleSubmit} disabled={loading} className="gap-1.5">
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            确认修改
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ========= Tab: 用户反馈 =========
interface FeedbackRow {
  id: number;
  card_code: string;
  type: string;
  content: string;
  contact: string | null;
  context: string | null;
  status: string;
  admin_reply: string | null;
  created_at: string;
  updated_at: string;
}

const FEEDBACK_TYPE_META: Record<string, { label: string; cls: string }> = {
  bug: { label: '问题反馈', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  feature: { label: '功能建议', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  question: { label: '使用咨询', cls: 'bg-sky-50 text-sky-700 border-sky-200' },
  other: { label: '其他', cls: 'bg-slate-50 text-slate-600 border-slate-200' },
};

const FEEDBACK_STATUS_META: Record<string, { label: string; cls: string }> = {
  pending: { label: '待处理', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  replied: { label: '已回复', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  closed: { label: '已关闭', cls: 'bg-slate-50 text-slate-500 border-slate-200' },
};

function FeedbackPanel({ fetcher }: { fetcher: AdminFetcher }) {
  const [rows, setRows] = useState<FeedbackRow[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({ all: 0, pending: 0, replied: 0, closed: 0 });
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'replied' | 'closed'>('all');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  // 回复状态：当前展开回复框的反馈 id + 草稿
  const [replyId, setReplyId] = useState<number | null>(null);
  const [replyDraft, setReplyDraft] = useState('');
  const [replySaving, setReplySaving] = useState(false);
  // 展开错误上下文的反馈 id
  const [ctxOpenId, setCtxOpenId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetcher(`/api/admin/feedback?status=${filterStatus}&page=${page}&pageSize=10`);
      const data = await res.json();
      if (data.success) {
        setRows(data.rows as FeedbackRow[]);
        setTotal(data.total);
        setCounts(data.counts);
      } else {
        toast.error(data.error || '加载反馈失败');
      }
    } catch {
      toast.error('网络错误，加载反馈失败');
    } finally {
      setLoading(false);
    }
  }, [fetcher, filterStatus, page]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSaveReply = async (id: number, close = false) => {
    const reply = replyDraft.trim();
    if (!close && reply.length === 0) {
      toast.error('请先填写回复内容');
      return;
    }
    setReplySaving(true);
    try {
      const res = await fetcher('/api/admin/feedback', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(close ? { id, status: 'closed' } : { id, adminReply: reply }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        toast.error(data.error || '操作失败');
        return;
      }
      toast.success(close ? '反馈已关闭' : '回复已保存');
      setReplyId(null);
      setReplyDraft('');
      load();
    } catch {
      toast.error('网络错误，操作失败');
    } finally {
      setReplySaving(false);
    }
  };

  const totalPages = Math.max(Math.ceil(total / 10), 1);

  const chips: Array<{ key: 'all' | 'pending' | 'replied' | 'closed'; label: string }> = [
    { key: 'all', label: '全部' },
    { key: 'pending', label: '待处理' },
    { key: 'replied', label: '已回复' },
    { key: 'closed', label: '已关闭' },
  ];

  return (
    <div className="space-y-4">
      {/* 状态筛选 chips */}
      <div className="flex flex-wrap items-center gap-2">
        {chips.map((c) => (
          <button
            key={c.key}
            onClick={() => { setFilterStatus(c.key); setPage(1); }}
            className={`flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm transition-colors ${
              filterStatus === c.key
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-white text-muted-foreground hover:border-primary/40 hover:text-foreground'
            }`}
          >
            {c.label}
            <span className={`rounded-full px-1.5 text-xs ${filterStatus === c.key ? 'bg-primary-foreground/20' : 'bg-muted'}`}>
              {counts[c.key] ?? 0}
            </span>
          </button>
        ))}
      </div>

      {/* 反馈列表 */}
      {loading ? (
        <div className="py-16 text-center text-muted-foreground">
          <Loader2 className="mx-auto h-6 w-6 animate-spin mb-2" />
          加载中...
        </div>
      ) : rows.length === 0 ? (
        <Card className="border-border/60">
          <CardContent className="py-16 text-center text-muted-foreground">
            <MessageCircle className="mx-auto h-10 w-10 mb-3 opacity-40" />
            暂无反馈
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((f) => {
            const typeMeta = FEEDBACK_TYPE_META[f.type] || FEEDBACK_TYPE_META.other;
            const statusMeta = FEEDBACK_STATUS_META[f.status] || FEEDBACK_STATUS_META.pending;
            let ctx: Record<string, unknown> | null = null;
            if (f.context) {
              try { ctx = JSON.parse(f.context); } catch { ctx = null; }
            }
            return (
              <Card key={f.id} className={`border-border/60 ${f.status === 'pending' ? 'border-amber-200/70' : ''}`}>
                <CardContent className="space-y-3 pt-5">
                  {/* 头部：类型 + 状态 + 卡密 + 时间 */}
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className={typeMeta.cls}>{typeMeta.label}</Badge>
                    <Badge variant="outline" className={statusMeta.cls}>{statusMeta.label}</Badge>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {f.created_at?.slice(0, 16).replace('T', ' ')}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground font-mono">
                    卡密：{f.card_code}
                  </div>

                  {/* 反馈内容 */}
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">{f.content}</p>

                  {/* 联系方式 */}
                  {f.contact && (
                    <div className="text-xs text-muted-foreground">
                      联系方式：<span className="text-foreground font-medium">{f.contact}</span>
                    </div>
                  )}

                  {/* 错误上下文（错误入口自动附带） */}
                  {ctx && (
                    <div>
                      <button
                        type="button"
                        onClick={() => setCtxOpenId(ctxOpenId === f.id ? null : f.id)}
                        className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {ctxOpenId === f.id ? '收起' : '展开'}操作信息（自动附带）
                      </button>
                      {ctxOpenId === f.id && (
                        <pre className="mt-1.5 rounded-lg bg-muted/60 border border-border/60 p-3 text-xs overflow-auto max-h-40 font-mono leading-relaxed">
{JSON.stringify(ctx, null, 2)}
                        </pre>
                      )}
                    </div>
                  )}

                  {/* 已有回复 */}
                  {f.admin_reply && (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3">
                      <div className="text-xs font-medium text-emerald-700 mb-1">我的回复</div>
                      <p className="text-sm leading-relaxed text-emerald-900 whitespace-pre-wrap">{f.admin_reply}</p>
                    </div>
                  )}

                  {/* 操作区：回复 / 关闭 */}
                  {f.status !== 'closed' && (
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5 h-8"
                        onClick={() => {
                          if (replyId === f.id) { setReplyId(null); setReplyDraft(''); }
                          else { setReplyId(f.id); setReplyDraft(f.admin_reply || ''); }
                        }}
                      >
                        <MessageCircle className="h-3.5 w-3.5" />
                        {replyId === f.id ? '取消回复' : f.admin_reply ? '修改回复' : '回复'}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 text-muted-foreground"
                        disabled={replySaving}
                        onClick={() => handleSaveReply(f.id, true)}
                      >
                        关闭反馈
                      </Button>
                    </div>
                  )}
                  {replyId === f.id && (
                    <div className="space-y-2 rounded-lg border border-border/60 bg-muted/30 p-3">
                      <Textarea
                        placeholder="回复内容（仅后台留存记录，用户端暂不展示）"
                        value={replyDraft}
                        onChange={(e) => setReplyDraft(e.target.value.slice(0, 500))}
                        className="min-h-[70px] text-sm bg-white"
                      />
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">{replyDraft.length}/500</span>
                        <div className="flex gap-2">
                          <Button size="sm" variant="ghost" className="h-8" onClick={() => { setReplyId(null); setReplyDraft(''); }}>
                            取消
                          </Button>
                          <Button size="sm" className="h-8" disabled={replySaving} onClick={() => handleSaveReply(f.id)}>
                            {replySaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                            保存回复
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* 分页 */}
      {!loading && rows.length > 0 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>共 {total} 条 · 第 {page}/{totalPages} 页</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft className="h-4 w-4" /> 上一页
            </Button>
            <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              下一页 <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ========= Tab 4: 数据维护（备份下载 / 恢复上传） =========
// 适用场景：
//   - Railway 免费版没有 Volume，每次重新部署容器磁盘会重置；
//     部署完后把之前下载的 .db 通过这里一键上传，所有卡密/配置/日志原样恢复。
//   - 任何平台切换（Render → 阿里云 → 腾讯云）时，都能跨平台一键迁移完整数据库。
function MaintenancePanel({ fetcher }: { fetcher: AdminFetcher }) {
  const [downloading, setDownloading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const res = await fetcher('/api/admin/db/backup');
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || `备份失败 (HTTP ${res.status})`);
        return;
      }
      // 从响应头取文件名，取不到就用默认
      let filename = `jingbao-workshop_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.db`;
      const disposition = res.headers.get('Content-Disposition');
      if (disposition) {
        const m = /filename="?([^";]+)"?/.exec(disposition);
        if (m) filename = m[1];
      }
      const buf = await res.arrayBuffer();
      const blob = new Blob([buf], { type: 'application/vnd.sqlite3' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast.success(`数据库备份已下载：${filename}`);
    } catch {
      toast.error('下载失败，网络或服务端异常');
    } finally {
      setDownloading(false);
    }
  };

  const onFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] || null;
    if (!f) return;
    if (!f.name.toLowerCase().endsWith('.db')) {
      toast.error('文件后缀必须是 .db（SQLite 3 数据库）');
      e.target.value = '';
      return;
    }
    setPendingFile(f);
    setConfirmOpen(true);
    e.target.value = '';
  };

  const confirmRestore = async () => {
    if (!pendingFile) return;
    setRestoring(true);
    try {
      const fd = new FormData();
      fd.append('db_file', pendingFile);
      const res = await fetcher('/api/admin/db/restore', {
        method: 'POST',
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        toast.success(data.message || '数据库已成功恢复');
        setPendingFile(null);
        setConfirmOpen(false);
        // 恢复后 admin session 可能还在（因为 admin_users 表和当前 token 匹配），
        // 但为了稳妥，1.5 秒后刷新整页重新校验权限
        setTimeout(() => window.location.reload(), 1500);
      } else {
        toast.error(data.error || `恢复失败 (HTTP ${res.status})`);
      }
    } catch {
      toast.error('网络错误');
    } finally {
      setRestoring(false);
    }
  };

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      {/* 备份下载 */}
      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Download className="h-5 w-5 text-emerald-600" />
            下载数据库备份
          </CardTitle>
          <CardDescription>
            导出当前全部数据到 .db 文件（卡密、管理员、使用日志、历史生成、AI 配置等），保存到本地电脑作为备份。
            建议每次大规模改卡密 / 改配置后都手动下载一次。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground space-y-2">
            <div>• 文件格式：SQLite 3（.db）</div>
            <div>• 包含：卡密表、管理员、使用日志、生成历史、系统配置（含加密后的 AI Key）</div>
            <div>• 兼容：可直接上传到另一台「镜爆工坊」实例做恢复 / 迁移</div>
            <div>• 建议：<strong className="text-foreground">部署到 Railway 免费版后，每周下载一次备份</strong>，避免容器重建丢数据</div>
          </div>
          <Button
            onClick={handleDownload}
            disabled={downloading}
            className="gap-2"
          >
            {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {downloading ? '正在打包下载…' : '下载 jingbao.db 备份'}
          </Button>
        </CardContent>
      </Card>

      {/* 恢复上传 */}
      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <UploadCloud className="h-5 w-5 text-amber-600" />
            从备份恢复数据库
          </CardTitle>
          <CardDescription>
            上传之前下载的 .db 文件，完整覆盖当前数据库。用于重新部署后的恢复，或从一个平台（Render）迁到另一平台（阿里云 / 腾讯云）。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Alert className="border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-900">
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle className="text-sm font-semibold">危险操作</AlertTitle>
            <AlertDescription className="text-xs leading-relaxed">
              恢复会直接<strong>覆盖当前数据库</strong>。系统会自动在服务器
              <code className="mx-1 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] dark:bg-amber-900/40">/backups/restore_before_时间戳.db</code>
              保存一份旧库快照，如操作失误可在服务端手动回滚。
            </AlertDescription>
          </Alert>
          <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground space-y-2">
            <div>• 只能上传之前由本系统「下载数据库备份」导出的 .db 文件</div>
            <div>• 文件头校验必须是 SQLite 3，且内含 cards / admin_users / system_config 三张表</div>
            <div>• 操作成功后页面会自动刷新，请重新登录管理后台</div>
            <div>• 典型场景：Railway 重新部署容器后 → 上传上次备份 → 数据全回来了 ✅</div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".db,application/vnd.sqlite3,application/octet-stream"
            className="hidden"
            onChange={onFileSelected}
          />
          <Button
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={restoring}
            className="gap-2"
          >
            {restoring ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
            {restoring ? '正在恢复…' : '选择 .db 文件并恢复'}
          </Button>
        </CardContent>
      </Card>

      {/* 恢复二次确认弹窗 */}
      <AlertDialog open={confirmOpen} onOpenChange={(o) => !restoring && setConfirmOpen(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认覆盖数据库？</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              即将恢复数据库：
              <div className="rounded border border-border p-2.5 mt-1.5 text-xs font-mono break-all">
                {pendingFile?.name}（{(pendingFile ? (pendingFile.size / 1024).toFixed(1) : '0')} KB）
              </div>
              <div className="text-rose-600 dark:text-rose-400 pt-1">
                ⚠️ 当前所有卡密、日志、系统配置都会被替换。旧库会在服务器端自动备份一份，不会丢失。
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={restoring}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={restoring}
              onClick={(e) => { e.preventDefault(); void confirmRestore(); }}
              className="bg-rose-600 hover:bg-rose-700 text-white focus:ring-rose-500"
            >
              {restoring && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {restoring ? '恢复中，请稍候…' : '确认覆盖并恢复'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ========= 页面入口 =========
export default function AdminPage() {
  const [session, setSession] = useState<AdminSession | null>(null);
  const [ready, setReady] = useState(false);
  const [pwdOpen, setPwdOpen] = useState(false);

  // 统一的过期处理：清 localStorage、清 state、提示（每个面板都通过 adminFetch 间接触发）
  const handleExpired = useCallback(() => {
    localStorage.removeItem(ADMIN_SESSION_KEY);
    setSession(null);
    toast.error('登录已过期，请重新登录', { duration: 4000 });
  }, []);

  // 带鉴权的 fetch 包装：收到 401 时自动触发 handleExpired；收到续期头时自动更新 session
  const adminFetch = useCallback(
    async (input: string, init?: RequestInit, silent401 = false) => {
      const headers = { ...withAuth(session?.token || ''), ...(init?.headers || {}) };
      const res = await fetch(input, { ...init, headers });
      if (res.status === 401) {
        if (!silent401) handleExpired();
      }
      // 检查续期头：token 快过期时服务端会自动换新
      const renewedToken = res.headers.get('X-Renewed-Token');
      const renewedExpiresAt = res.headers.get('X-Renewed-Expires-At');
      if (renewedToken && renewedExpiresAt && session) {
        const updated: AdminSession = { ...session, token: renewedToken, expiresAt: renewedExpiresAt };
        setSession(updated);
        try { localStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify(updated)); } catch { /* ignore */ }
      }
      return res;
    },
    [session, handleExpired],
  );

  // 初始化：读 localStorage + 本地过期检查
  useEffect(() => {
    const stored = localStorage.getItem(ADMIN_SESSION_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as AdminSession;
        // 本地过期检查：有 expiresAt 且已过期 → 清除
        if (!parsed.token || !parsed.expiresAt || new Date(parsed.expiresAt) <= new Date()) {
          localStorage.removeItem(ADMIN_SESSION_KEY);
        } else {
          setSession(parsed);
        }
      } catch {
        localStorage.removeItem(ADMIN_SESSION_KEY);
      }
    }
    setReady(true);
  }, []);

  // 自动退出定时器：token 即将过期时自动清除 session（设 1 分钟缓冲，避免刚过期就被打断）
  useEffect(() => {
    if (!session?.expiresAt) return;
    const msLeft = new Date(session.expiresAt).getTime() - Date.now() - 60_000;
    if (msLeft <= 0) {
      handleExpired();
      return;
    }
    const timer = setTimeout(() => handleExpired(), msLeft);
    return () => clearTimeout(timer);
  }, [session?.expiresAt, handleExpired]);

  const handleLogout = () => {
    localStorage.removeItem(ADMIN_SESSION_KEY);
    setSession(null);
    toast.success('已退出管理后台');
  };

  return (
    <div className="min-h-screen bg-background">
      {/* 管理后台专属顶栏 */}
      <header className="sticky top-0 z-40 w-full border-b border-border/60 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-2 font-bold">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-md shadow-primary/20">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <span className="text-lg">管理后台</span>
            {session && (
              <Badge variant="outline" className="ml-1 hidden sm:inline-flex">
                {session.admin.username}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Link href="/">
              <Button variant="outline" size="sm" className="gap-1.5">
                <Home className="h-4 w-4" /> 返回首页
              </Button>
            </Link>
            {session && (
              <Button variant="outline" size="sm" onClick={() => setPwdOpen(true)} className="gap-1.5">
                <KeyRound className="h-4 w-4" /> 修改密码
              </Button>
            )}
            {session && (
              <Button variant="outline" size="sm" onClick={handleLogout} className="gap-1.5 text-destructive hover:text-destructive">
                <LogOut className="h-4 w-4" /> 退出
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 sm:px-6 py-8">
        {session?.usingDefaultPassword && (
          <div className="mb-6 flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <span>
              <Lock className="mr-1.5 inline h-4 w-4" />
              当前仍在使用默认密码，存在安全风险，建议立即修改
            </span>
            <Button size="sm" variant="outline" className="shrink-0 gap-1.5 border-amber-300 text-amber-800 hover:bg-amber-100 hover:text-amber-900" onClick={() => setPwdOpen(true)}>
              <KeyRound className="h-3.5 w-3.5" /> 立即修改
            </Button>
          </div>
        )}
        {!ready ? (
          <div className="py-32 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
          </div>
        ) : session ? (
          <AdminDashboard fetcher={adminFetch} onLogout={handleLogout} />
        ) : (
          <AdminLogin onLogin={setSession} />
        )}
      </main>

      <footer className="border-t border-border/60 py-4">
        <div className="mx-auto max-w-6xl px-4 text-center text-xs text-muted-foreground flex items-center justify-center gap-1.5">
          <Film className="h-3.5 w-3.5" />
          {SITE_NAME} · 管理后台
        </div>
      </footer>

      {session && (
        <ChangePasswordDialog
          fetcher={adminFetch}
          open={pwdOpen}
          onOpenChange={setPwdOpen}
          onChanged={() => {
            // 密码已变更，强制登出重新登录
            setPwdOpen(false);
            localStorage.removeItem(ADMIN_SESSION_KEY);
            setSession(null);
            toast.success('密码已修改，请重新登录');
          }}
        />
      )}
    </div>
  );
}
