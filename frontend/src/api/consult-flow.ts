import type { EntryRow } from '@/data/types'

// ─── 专家会商统一判定 ────────────────────────────────────────────────
// 背景：提交结论与取消会商过去各判一套（会商编号重没重、会商主题与参会专家
// 是否齐全、建议措施写没写），两套并行，改了一边漏了另一边，结论常常分岔。
// 现在两个入口都调 decideConsultTransition：同一条记录、同一份数据，
// 两个入口只许给出同一个结果。要改规则只改这一份。
//
// 状态机：待组织 → 已组织 → 已出结论；待组织 / 已组织 → 已取消。
// 只许逐段推进，跳级一律拦下；已出结论、已取消是终态，不再接受任何动作。
// 重复评估只认先到的那一份：已到终态的重复动作直接退回，不覆盖既有结论。
//
// 字段校验优先级（自上而下，命中即返回，两个入口共用同一份）：
//   1. 会商编号为空 → 按无效值处理，退回重填
//   2. 会商编号重复 → 只认先到的那一份（编号相同取 id 最小者），其余退回
//   3. 会商主题、参会专家任一为空 → 按无效值处理，退回补全
//   4. 建议措施为空（含纯空白）→ 按无效值处理，退回重填
//   5. 纪要归档日不单独拦截（老数据里归档日格式不一，重构不碰老数据，
//      也不因老格式卡新流程）。建议措施与纪要归档日打架时——归档日已填、
//      措施却空——以建议措施的判定为准：第 4 条先命中，报的是建议措施
//      的问题，不是归档日的问题；反过来措施已写、归档日空着不算打架，
//      纪要允许结论之后补归档。
// 确认组织只做状态机判断：建议措施等结论类字段在会商召开后才产生，
// 不在组织阶段拦截。

const TRANSITIONS: Record<string, { from: string[]; to: string }> = {
  确认组织: { from: ['待组织'], to: '已组织' },
  提交结论: { from: ['已组织'], to: '已出结论' },
  取消会商: { from: ['待组织', '已组织'], to: '已取消' },
}

const TERMINAL_STATUSES = ['已出结论', '已取消']

export type ConsultDecision =
  | { ok: true; row: EntryRow; target: string }
  | { ok: false; message: string }

function text(value: unknown): string {
  return String(value ?? '').trim()
}

// 统一校验：提交结论与取消会商都过这一套，顺序即优先级（见文件头注释）。
function checkConsultRow(row: EntryRow, rows: EntryRow[]): { ok: boolean; message: string } {
  const code = text(row['会商编号'])
  if (!code) {
    return { ok: false, message: '会商编号为空，按无效值处理，退回重填' }
  }
  const first = rows
    .filter((item) => text(item['会商编号']) === code)
    .sort((a, b) => Number(a.id) - Number(b.id))[0]
  if (first && Number(first.id) !== Number(row.id)) {
    return {
      ok: false,
      message: `会商编号 ${code} 与编号 ${first.id} 的会商重复，重复评估只认先到的那一份`,
    }
  }
  if (!text(row['会商主题'])) {
    return { ok: false, message: '会商主题为空，按无效值处理，退回补全' }
  }
  if (!text(row['参会专家'])) {
    return { ok: false, message: '参会专家为空，按无效值处理，退回补全' }
  }
  if (!text(row['建议措施'])) {
    return { ok: false, message: '建议措施为空，按无效值处理，退回重填' }
  }
  return { ok: true, message: '' }
}

export function decideConsultTransition(
  rows: EntryRow[],
  id: number,
  action: string,
): ConsultDecision {
  const transition = TRANSITIONS[action]
  if (!transition) {
    return { ok: false, message: `专家会商没有登记「${action}」这个动作` }
  }
  const row = rows.find((item) => Number(item.id) === id)
  if (!row) {
    return { ok: false, message: `没有找到编号为 ${id} 的专家会商` }
  }
  const current = String(row.status)

  // 终态：先到的那一份已经生效，后来的重复动作一律退回
  if (TERMINAL_STATUSES.includes(current)) {
    if (current === transition.to) {
      const noun = action === '提交结论' ? '重复评估只认先到的那一份' : '重复操作不生效'
      return { ok: false, message: `专家会商已是「${current}」，${noun}，本次${action}不生效` }
    }
    return { ok: false, message: `专家会商已是「${current}」终态，不能再${action}` }
  }
  if (current === transition.to) {
    return { ok: false, message: `专家会商已经是「${transition.to}」，不用重复操作` }
  }
  // 跳级一律拦下：只能从规定的前一段发起
  if (!transition.from.includes(current)) {
    return {
      ok: false,
      message: `专家会商当前「${current}」，「${action}」只能从「${transition.from.join('」或「')}」发起，跳级操作已拦下`,
    }
  }

  // 提交结论与取消会商共用同一份字段校验，两个入口不许给出两种结果
  if (action === '提交结论' || action === '取消会商') {
    const check = checkConsultRow(row, rows)
    if (!check.ok) {
      return { ok: false, message: check.message }
    }
  }
  return { ok: true, row, target: transition.to }
}

// 评估的结论 → 应急演练待办：会商一出结论，演练清单同步冒出一条待核项。
// 多处取数时参会专家保持同一份：这里直接引用会商快照里的参会专家，
// 不另抄、不改写，演练待办看到的与会商清单里的是同一份。
export function buildDrillTodo(consult: EntryRow, drillRows: EntryRow[]): EntryRow {
  const nextId = drillRows.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1
  const maxCode = drillRows.reduce((max, item) => {
    const matched = /^DRIL-(\d+)$/.exec(text(item['演练编号']))
    return matched ? Math.max(max, Number(matched[1])) : max
  }, 0)
  return {
    id: nextId,
    status: '待组织',
    pending: true,
    abnormal: false,
    演练编号: `DRIL-${String(maxCode + 1).padStart(4, '0')}`,
    演练主题: `落实会商${text(consult['会商编号'])}结论：${text(consult['会商主题'])}`,
    参演队伍: text(consult['参会专家']),
    参演人数: '待定',
    演练日期: '待定',
    演练科目: text(consult['建议措施']),
    评估结论: text(consult['会商结论']),
    演练状态: '待组织',
  }
}
