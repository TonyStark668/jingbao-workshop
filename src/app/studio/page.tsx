'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import ProtectedPage from '@/components/protected-page';
import { StoryboardTool } from '@/components/tools/storyboard-tool';
import { TitlesTool } from '@/components/tools/titles-tool';
import { PolishTool } from '@/components/tools/polish-tool';
import { CharacterViewsTool } from '@/components/tools/character-views-tool';
import { Clapperboard, Sparkles, History, PenLine, PersonStanding } from 'lucide-react';

type ToolKey = 'storyboard' | 'titles' | 'polish' | 'charviews';

const TOOL_GROUPS: { label: string; tools: { key: ToolKey; label: string; desc: string; icon: typeof Clapperboard; color: string }[] }[] = [
  {
    label: '文案准备',
    tools: [
      { key: 'polish', label: '文案润色', desc: '润色·扩写·缩写', icon: PenLine, color: 'text-emerald-500' },
    ],
  },
  {
    label: '分镜创作',
    tools: [
      { key: 'storyboard', label: '文本转分镜', desc: '文案一键生成分镜表', icon: Clapperboard, color: 'text-primary' },
      { key: 'titles', label: 'AI爆款标题', desc: '一次生成10组标题', icon: Sparkles, color: 'text-fuchsia-500' },
    ],
  },
  {
    label: '角色资产',
    tools: [
      { key: 'charviews', label: '角色三视图', desc: '生成角色设定图提示词', icon: PersonStanding, color: 'text-amber-500' },
    ],
  },
];

const ALL_TOOLS = TOOL_GROUPS.flatMap((g) => g.tools);

function StudioInner() {
  const searchParams = useSearchParams();
  const param = searchParams.get('tool');
  const tool: ToolKey = ALL_TOOLS.some((t) => t.key === param) ? (param as ToolKey) : 'storyboard';

  return (
    <ProtectedPage>
      <div className="flex flex-col lg:flex-row gap-6">
        {/* 左侧功能菜单（桌面按组竖排 / 移动端横排） */}
        <aside className="lg:w-56 shrink-0">
          <div className="lg:sticky lg:top-20 space-y-1.5">
            <div className="hidden lg:block text-xs font-semibold text-muted-foreground px-3 mb-2">
              创作工具
            </div>
            <nav className="flex lg:flex-col gap-1.5 overflow-x-auto lg:overflow-visible pb-1 lg:pb-0">
              {TOOL_GROUPS.map((group) => (
                <div key={group.label} className="flex lg:flex-col gap-1.5">
                  <div className="hidden lg:flex items-center gap-2 px-3 pt-2 pb-1">
                    <span className="text-[11px] font-semibold text-muted-foreground/70 tracking-wide">{group.label}</span>
                  </div>
                  {group.tools.map((t) => {
                    const Icon = t.icon;
                    const active = tool === t.key;
                    return (
                      <Link
                        key={t.key}
                        href={`/studio?tool=${t.key}`}
                        className={`flex items-center gap-3 rounded-xl px-3.5 py-3 text-sm font-medium whitespace-nowrap transition-colors ${
                          active
                            ? 'bg-primary text-primary-foreground shadow-md shadow-primary/20'
                            : 'text-muted-foreground hover:bg-muted hover:text-foreground border border-transparent hover:border-border/60'
                        }`}
                      >
                        <Icon className={`h-5 w-5 shrink-0 ${active ? '' : t.color}`} />
                        <span className="flex flex-col lg:flex-col">
                          {t.label}
                          <span className={`text-xs font-normal ${active ? 'text-primary-foreground/80' : 'text-muted-foreground/80'}`}>
                            {t.desc}
                          </span>
                        </span>
                      </Link>
                    );
                  })}
                </div>
              ))}
              <Link
                href="/history"
                className="flex items-center gap-3 rounded-xl px-3.5 py-3 text-sm font-medium whitespace-nowrap text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                <History className="h-5 w-5 shrink-0" />
                <span className="flex flex-col">
                  历史记录
                  <span className="text-xs font-normal text-muted-foreground/80">查看生成过的内容</span>
                </span>
              </Link>
            </nav>
          </div>
        </aside>

        {/* 右侧工作区 */}
        <main className="flex-1 min-w-0">
          {tool === 'storyboard' && <StoryboardTool />}
          {tool === 'titles' && <TitlesTool />}
          {tool === 'polish' && <PolishTool />}
          {tool === 'charviews' && <CharacterViewsTool />}
        </main>
      </div>
    </ProtectedPage>
  );
}

export default function StudioPage() {
  return (
    <Suspense fallback={null}>
      <StudioInner />
    </Suspense>
  );
}
