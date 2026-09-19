import { NextRequest, NextResponse } from 'next/server';
import { authenticateCard, withRenewHeader } from '@/lib/server/auth';
import { listGeneratedHistory, deleteGeneratedHistory, clearGeneratedHistory } from '@/lib/server/card-service';

export function GET(request: NextRequest) {
  const auth = authenticateCard(request);
  if (!auth.ok) {
    return NextResponse.json(
      { success: false, code: auth.code, error: auth.error },
      { status: auth.status || 401 },
    );
  }
  const list = listGeneratedHistory(auth.cardId!, 100);

  // 映射为前端需要的结构：HistoryItem（storyboard / titles / polish / character_views）
  const items = list.map((r) => {
    if (r.type === 'storyboard') {
      const out = r.output as { title: string; shots: unknown[]; creationMode?: 'real' | 'ai' | 'hybrid' };
      return {
        id: r.id,
        type: 'storyboard' as const,
        title: out.title || '分镜脚本',
        createdAt: r.createdAt,
        inputText: r.inputText,
        shots: out.shots || [],
        ...(out.creationMode ? { creationMode: out.creationMode } : {}),
      };
    } else if (r.type === 'polish') {
      const out = r.output as { mode?: 'polish' | 'expand' | 'condense'; text?: string };
      return {
        id: r.id,
        type: 'polish' as const,
        title: '文案润色',
        createdAt: r.createdAt,
        inputText: r.inputText,
        mode: out.mode || 'polish',
        text: out.text || '',
      };
    } else if (r.type === 'character_views') {
      const out = r.output as { characters?: Array<{ name?: string; prompt?: string }> };
      return {
        id: r.id,
        type: 'character_views' as const,
        title: '角色三视图',
        createdAt: r.createdAt,
        inputText: r.inputText,
        characters: (out.characters || []).map((c) => ({
          name: (c.name || '').trim() || '未命名角色',
          prompt: (c.prompt || '').trim(),
        })).filter((c) => c.prompt),
      };
    } else {
      const out = r.output as { titles: string[] };
      return {
        id: r.id,
        type: 'titles' as const,
        title: '爆款标题',
        createdAt: r.createdAt,
        inputText: r.inputText,
        titles: out.titles || [],
      };
    }
  });

  return withRenewHeader(NextResponse.json({ success: true, items }), auth);
}

/**
 * 删除历史记录：
 * - 带 ?id=xxx 删除单条
 * - 不带 id 清空该卡密全部记录
 */
export async function DELETE(request: NextRequest) {
  const auth = authenticateCard(request);
  if (!auth.ok) {
    return NextResponse.json(
      { success: false, code: auth.code, error: auth.error },
      { status: auth.status || 401 },
    );
  }

  const id = request.nextUrl.searchParams.get('id');
  if (id) {
    const deleted = deleteGeneratedHistory(id, auth.cardId!);
    if (!deleted) {
      return NextResponse.json({ success: false, error: '记录不存在或已删除' }, { status: 404 });
    }
    return withRenewHeader(NextResponse.json({ success: true, deleted: 1 }), auth);
  }

  const count = clearGeneratedHistory(auth.cardId!);
  return withRenewHeader(NextResponse.json({ success: true, deleted: count }), auth);
}
