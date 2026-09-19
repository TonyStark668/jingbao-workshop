// 卡密领域服务：状态机 + 次数 + 限流 + 有效期校验

import { db, CardRow, CardStatus } from '@/lib/server/db';
import { CONFIG } from '@/lib/server/config';
import { todayStartKey, tzModifier } from '@/lib/server/card-utils';

/**
 * 统一更新过期状态：任何查询/操作前把过了期的 active 置为 expired
 */
export function autoExpire(): void {
  db.prepare(
    `UPDATE cards SET status = 'expired'
     WHERE status = 'active' AND expires_at IS NOT NULL AND datetime('now') >= datetime(expires_at)`,
  ).run();
}

export function getCardByCode(code: string): CardRow | undefined {
  autoExpire();
  return db.prepare('SELECT * FROM cards WHERE code = ?').get(code) as CardRow | undefined;
}

export function getCardById(id: number): CardRow | undefined {
  autoExpire();
  return db.prepare('SELECT * FROM cards WHERE id = ?').get(id) as CardRow | undefined;
}

/** 判断卡密当前是否可用（未冻结/未作废/未过期，未激活的 unused 算可用，激活后自己置 active） */
export function isCardUsable(card: CardRow): { ok: boolean; reason?: string } {
  switch (card.status) {
    case 'unused':
      return { ok: true };
    case 'active':
      if (card.expires_at && new Date(card.expires_at).getTime() < Date.now()) {
        return { ok: false, reason: '卡密已过期' };
      }
      return { ok: true };
    case 'frozen':
      return { ok: false, reason: '卡密已被冻结，请联系客服' };
    case 'revoked':
      return { ok: false, reason: '卡密已作废' };
    case 'expired':
      return { ok: false, reason: '卡密已过期' };
    default:
      return { ok: false, reason: '卡密状态异常' };
  }
}

/** 激活卡密（首次验证通过时调用）：按卡密自身 valid_days 计算有效期 */
export function activateCard(cardId: number): void {
  const card = getCardById(cardId);
  const validDays = card?.valid_days ?? CONFIG.CARD_VALID_DAYS;
  const now = new Date().toISOString();
  const expire = new Date(Date.now() + validDays * 24 * 3600 * 1000).toISOString();
  db.prepare(
    `UPDATE cards SET status = 'active', activated_at = COALESCE(activated_at, ?), expires_at = COALESCE(expires_at, ?) WHERE id = ?`,
  ).run(now, expire, cardId);
}

/** 更新最后使用信息（IP/指纹/时间） */
export function touchCardUsage(cardId: number, ip: string, fingerprint: string): void {
  db.prepare(
    `UPDATE cards SET last_used_at = datetime('now'), last_ip = ?, last_fingerprint = ? WHERE id = ?`,
  ).run(ip, fingerprint, cardId);
}

/** 查当日已用次数（基于配置时区当日；按模型档位成本加权，detail.cost 为空算 1 次）
 *  created_at 为 UTC 存储，比较前先用 strftime 偏移到本地时区取日期，避免凌晨时段跨日错账 */
export function getDailyUsed(cardId: number): number {
  const dayKey = todayStartKey();
  const rows = db
    .prepare(
      `SELECT detail FROM usage_logs
       WHERE card_id = ?
         AND success = 1
         AND action IN ('storyboard', 'titles', 'polish', 'character_views')
         AND strftime('%Y-%m-%d', created_at, ?) = ?`,
    )
    .all(cardId, tzModifier(), dayKey) as Array<{ detail: string | null }>;
  return rows.reduce((sum, r) => {
    let cost = 1;
    if (r.detail) {
      try {
        const d = JSON.parse(r.detail) as { cost?: number };
        if (typeof d.cost === 'number' && d.cost > 0) cost = d.cost;
      } catch { /* detail 非 JSON 时按 1 次 */ }
    }
    return sum + cost;
  }, 0);
}

/** 次数用尽引导文案（后台 system_config.exhausted_tip 配置，空 = 不提示） */
export function getExhaustedTip(): string {
  try {
    const row = db.prepare('SELECT value FROM system_config WHERE key = ?').get('exhausted_tip') as
      | { value: string }
      | undefined;
    return (row?.value || '').trim();
  } catch {
    return '';
  }
}

/** 同一卡密近 60 秒的请求数（用于防刷） */
export function getRecentMinuteCalls(cardId: number): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS cnt FROM usage_logs
       WHERE card_id = ? AND created_at >= datetime('now', '-60 seconds')`,
    )
    .get(cardId) as { cnt: number };
  return row?.cnt || 0;
}

/** 写一条使用日志（cardId 可空，用于卡密不存在时也能记录失败日志） */
export function writeUsageLog(params: {
  cardId?: number;
  cardCode: string;
  action: string;
  success: boolean;
  ip?: string;
  userAgent?: string;
  fingerprint?: string;
  detail?: unknown;
}): void {
  db.prepare(
    `INSERT INTO usage_logs (card_id, card_code, action, success, ip, user_agent, fingerprint, detail)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    params.cardId ?? null,
    params.cardCode,
    params.action,
    params.success ? 1 : 0,
    params.ip || null,
    params.userAgent || null,
    params.fingerprint || null,
    params.detail == null ? null : typeof params.detail === 'string' ? params.detail : JSON.stringify(params.detail),
  );
}

/** 续期：延长激活/已过期卡密的有效期（从"现在"与"原到期日"较晚者起加 addDays；过期卡自动恢复 active） */
export function renewCardExpiry(cardId: number, addDays: number): { ok: boolean; message?: string } {
  const card = getCardById(cardId);
  if (!card) return { ok: false, message: '卡密不存在' };
  if (card.status !== 'active' && card.status !== 'expired') {
    return { ok: false, message: `仅激活/已过期卡可续期（当前状态：${card.status}）` };
  }
  const now = Date.now();
  const currentExpiry = card.expires_at ? new Date(card.expires_at).getTime() : now;
  const newExpiry = new Date(Math.max(currentExpiry, now) + addDays * 24 * 3600 * 1000);
  db.prepare(
    `UPDATE cards SET
       expires_at = ?,
       status = CASE WHEN status = 'expired' THEN 'active' ELSE status END
     WHERE id = ?`,
  ).run(newExpiry.toISOString(), cardId);
  return { ok: true };
}

/** 状态变更：冻结/解冻/作废 */
export function setCardStatus(code: string, status: CardStatus): boolean {
  const result = db.prepare(`UPDATE cards SET status = ? WHERE code = ?`).run(status, code);
  return (result.changes || 0) > 0;
}

/** 批量插入卡密（返回插入成功条数） */
export function batchInsertCards(codes: string[], opts?: { validDays?: number; dailyLimit?: number; remark?: string }): number {
  const validDays = opts?.validDays ?? CONFIG.CARD_VALID_DAYS;
  const dailyLimit = opts?.dailyLimit ?? CONFIG.DAILY_LIMIT;
  const remark = opts?.remark ?? null;
  const insert = db.prepare(
    `INSERT OR IGNORE INTO cards (code, status, valid_days, daily_limit, remark) VALUES (?, 'unused', ?, ?, ?)`,
  );
  const tx = db.transaction((list: string[]) => {
    let n = 0;
    for (const code of list) {
      const r = insert.run(code, validDays, dailyLimit, remark);
      if (r.changes) n++;
    }
    return n;
  });
  return tx(codes);
}

/** 删除单条生成历史（校验归属卡密） */
export function deleteGeneratedHistory(id: string, cardId: number): boolean {
  const result = db
    .prepare('DELETE FROM generated_history WHERE id = ? AND card_id = ?')
    .run(id, cardId);
  return result.changes > 0;
}

/** 清空某卡密的全部生成历史，返回删除条数 */
export function clearGeneratedHistory(cardId: number): number {
  const result = db
    .prepare('DELETE FROM generated_history WHERE card_id = ?')
    .run(cardId);
  return result.changes;
}

/** 写入生成历史（storyboard / titles / polish / character_views） */
export function saveGeneratedHistory(params: {
  id: string;
  cardId: number;
  cardCode: string;
  type: 'storyboard' | 'titles' | 'polish' | 'character_views';
  inputText: string;
  outputJson: unknown;
}): void {
  db.prepare(
    `INSERT OR IGNORE INTO generated_history (id, card_id, card_code, type, input_text, output_json) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    params.id,
    params.cardId,
    params.cardCode,
    params.type,
    params.inputText,
    JSON.stringify(params.outputJson),
  );
}

/** 查某卡密的生成历史（最近 100 条） */
export function listGeneratedHistory(cardId: number, limit = 100) {
  const rows = db
    .prepare(
      `SELECT id, type, input_text, output_json, created_at
       FROM generated_history
       WHERE card_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(cardId, limit) as Array<{
    id: string;
    type: 'storyboard' | 'titles' | 'polish' | 'character_views';
    input_text: string;
    output_json: string;
    created_at: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    inputText: r.input_text,
    createdAt: r.created_at,
    output: JSON.parse(r.output_json),
  }));
}
