import { listRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow } from '@/data/types'

/**
 * 专家会商的统一判定：提交结论与取消会商过去各判一套
 * （会商编号重没重、会商主题与参会专家是否齐全、建议措施写没写），
 * 两套并行，改一边漏另一边，结论常常分岔。
 * 现在只留这一份：两个入口都调 validateConsult，
 * 同一条记录、同一份数据，两个入口给出的判定必然一致。
 *
 * 重构不碰老数据：只读存量记录做判定，不回写、不清洗、不迁移；
 * 参会专家照旧保留原值，多处取数都取存储里的同一份。
 */

const CONSULT_KEY = 'consult'
const DRILL_KEY = 'drill'

// 状态逐段推进：待组织 → 已组织 → 已出结论；已取消是出结论之前的退出态。
// 跳级（如待组织直接提交结论）一律拦下；已出结论、已取消是终态，任何动作都拦下。
const TRANSITIONS: Record<string, { from: string[]; to: string }> = {
  确认组织: { from: ['待组织'], to: '已组织' },
  提交结论: { from: ['已组织'], to: '已出结论' },
  取消会商: { from: ['待组织', '已组织'], to: '已取消' },
}

const TERMINAL_STATUSES = ['已出结论', '已取消']

// 提交结论与取消会商共用同一套字段判定：两个入口都调它，不许给出两种结果。
const VALIDATED_ACTIONS = ['提交结论', '取消会商']

function text(value: EntryRow[string]): string {
  return String(value ?? '').trim()
}

/**
 * 统一判定，按序执行，命中即退回：
 * 1. 会商编号不能为空，且全库查重（含已取消的，编号一经占用不复用）；
 * 2. 会商主题、参会专家必须齐全；
 * 3. 建议措施必须已写；为空一律按无效值处理，退回重填。
 *
 * 建议措施与纪要归档日打架时的优先级：建议措施优先。
 * 纪要归档日已填不能顶替建议措施——建议措施为空照样退回重填；
 * 建议措施已写而纪要归档日空缺则不拦，归档日允许后补。
 */
export function validateConsult(row: EntryRow, rows: EntryRow[]): ActionResult {
  const code = text(row['会商编号'])
  if (!code) {
    return { ok: false, message: '会商编号为空，先补登记编号再办理' }
  }
  const duplicated = rows.some(
    (item) => Number(item.id) !== Number(row.id) && text(item['会商编号']) === code,
  )
  if (duplicated) {
    return { ok: false, message: `会商编号「${code}」与另一条会商重复` }
  }
  if (!text(row['会商主题'])) {
    return { ok: false, message: '会商主题未填写，退回补全' }
  }
  if (!text(row['参会专家'])) {
    return { ok: false, message: '参会专家未填写，退回补全' }
  }
  if (!text(row['建议措施'])) {
    if (text(row['纪要归档日'])) {
      return {
        ok: false,
        message: '纪要归档日已填但建议措施为空：以建议措施为准，按无效值处理，退回重填',
      }
    }
    return { ok: false, message: '建议措施为空，按无效值处理，退回重填' }
  }
  return { ok: true, message: '' }
}

/**
 * 评估结论反映到应急演练待办：会商一出结论，演练清单里冒出一条待核项。
 * 参会专家从会商记录上原样取（多处取数保持同一份，不复制改写、不二次加工）。
 * 重复评估只认先到的那一份：该会商的待核项已生成过就不再生成。
 * 返回生成的演练编号；已存在返回 null。
 */
function syncDrillTodo(consult: EntryRow): string | null {
  const drills = listRows(DRILL_KEY)
  const source = text(consult['会商编号'])
  if (drills.some((item) => text(item['来源会商编号']) === source)) {
    return null
  }
  const nextId = drills.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1
  const nextNumber =
    drills.reduce((max, item) => {
      const match = /^DRIL-(\d+)$/.exec(text(item['演练编号']))
      return match ? Math.max(max, Number(match[1])) : max
    }, 0) + 1
  const drillCode = `DRIL-${String(nextNumber).padStart(4, '0')}`
  const todo: EntryRow = {
    id: nextId,
    status: '待组织',
    pending: true,
    abnormal: false,
    演练编号: drillCode,
    演练主题: `会商待核：${text(consult['会商主题'])}`,
    参演队伍: String(consult['参会专家'] ?? ''),
    参演人数: '待核定',
    演练日期: String(consult['会商日期'] ?? ''),
    演练科目: String(consult['建议措施'] ?? ''),
    评估结论: String(consult['会商结论'] ?? ''),
    演练状态: '待核',
    来源会商编号: source,
  }
  saveRows(DRILL_KEY, [...drills, todo])
  return drillCode
}

/**
 * 专家会商的唯一流转入口：确认组织、提交结论、取消会商都走这里。
 * 先查状态推进（逐段、跳级拦下、终态拦下），再走统一判定，最后落库并联动演练待办。
 */
export function runConsultAction(id: number, action: string): ActionResult {
  const transition = TRANSITIONS[action]
  if (!transition) {
    return { ok: false, message: `专家会商没有登记「${action}」这个动作` }
  }
  const rows = listRows(CONSULT_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的专家会商` }
  }
  const row = rows[index]
  const current = String(row.status)

  // 重复评估只认先到的那一份：已出结论的会商再交结论，先到结论保持有效。
  if (action === '提交结论' && current === '已出结论') {
    return { ok: false, message: '该会商已出结论，重复评估只认先到的那一份，本次提交不生效' }
  }
  if (current === transition.to) {
    return { ok: false, message: `专家会商已经是「${transition.to}」，不用重复操作` }
  }
  if (TERMINAL_STATUSES.includes(current)) {
    return { ok: false, message: `当前状态「${current}」已是终态，会商已办结，不能再${action}` }
  }
  if (!transition.from.includes(current)) {
    return {
      ok: false,
      message: `状态逐段推进，不许跳级：「${action}」要求当前状态为「${transition.from.join('」或「')}」，实际为「${current}」`,
    }
  }

  // 提交结论与取消会商调同一份判定，两个入口不会给出两种结果。
  if (VALIDATED_ACTIONS.includes(action)) {
    const verdict = validateConsult(row, rows)
    if (!verdict.ok) {
      return verdict
    }
  }

  const updated: EntryRow = {
    ...row,
    status: transition.to,
    pending: !TERMINAL_STATUSES.includes(transition.to),
    abnormal: false,
  }
  const next = [...rows]
  next[index] = updated
  saveRows(CONSULT_KEY, next)

  let extra = ''
  if (action === '提交结论') {
    const drillCode = syncDrillTodo(updated)
    extra = drillCode
      ? `；应急演练清单已生成待核项「${drillCode}」`
      : '；应急演练待核项已存在，不重复生成'
  }
  return { ok: true, message: `专家会商已${action}，当前状态「${transition.to}」${extra}` }
}
