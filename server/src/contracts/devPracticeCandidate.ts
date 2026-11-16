import type { CandidateDiagnosticResult } from './candidateDiagnostic';
/** Explicitly negotiated DEV-only reply contract. */
export const DEV_PRACTICE_CONTRACT = 'dev-reply-practice-v1' as const;
export interface PracticeSuggestion { readonly ifCue: string; readonly thenAction: string }
export interface PracticeSuggestionSource {
  readonly sessionId: string;
  readonly devConversationId: string;
  readonly requestId: string;
}
export interface ValidatedPracticeReply {
  readonly contract: typeof DEV_PRACTICE_CONTRACT;
  readonly reply: string;
  readonly practiceCandidate: Readonly<PracticeSuggestion> | null;
  /** Server-owned turn identity, never supplied by model or copied from a pattern. */
  readonly source: Readonly<PracticeSuggestionSource>;
}
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return record(value) && Object.keys(value).length === keys.length
    && Object.keys(value).every(key => keys.includes(key));
}
const text = (value: unknown, max: number): value is string =>
  typeof value === 'string' && !!value.trim() && [...value].length <= max;
const id = (value: unknown): value is string => typeof value === 'string' && /^[\w-]{1,100}$/.test(value);
const evidenceKeys = ['permissionQuote', 'anchorQuote', 'naturalClosing', 'smallChoiceFits',
  'currentUserRequest', 'continuingExpression', 'correctionOrRefusalOrExit', 'topicChanged'] as const;

/**
 * Parse the entire raw content channel, before legacy natural-language cleaning.
 * No fences, substring extraction, reasoning fallback, template, retry or logging.
 * Evidence equality checks provenance only: model judgments still require real QA.
 * The caller must preserve cancellation/deadline checks before AND after this call,
 * and hold the result private until successful SSE terminal. EOF is not completion.
 */
export type PracticeReplyOptions = {
  latestUserMessage: string;
  providerCompleted: boolean;
  source: PracticeSuggestionSource;
  /** Existing fact/safety validator, with its original current-turn/context inputs. */
  validateReply: (reply: string) => string | { text: string; rejected: boolean };
  /** Negotiated recovery treats validator fallback as failure, never success. */
  rejectRewrittenReply?: boolean;
  replyMaxChars: number;
  /** Internal, enabled only by negotiated DEV opt-in; receives a fixed scalar, never content. */
  candidateDiagnostic?: (stage: CandidateDiagnosticResult) => void;
};

export function parseDevPracticeReply(raw: string, options: PracticeReplyOptions): ValidatedPracticeReply | null {
  if (!options.providerCompleted || typeof raw !== 'string' || raw.length > 12000
    || !exact(options.source, ['sessionId', 'devConversationId', 'requestId'])
    || !Object.values(options.source).every(id)
    || typeof options.latestUserMessage !== 'string'
    || !Number.isSafeInteger(options.replyMaxChars) || options.replyMaxChars <= 0) return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!exact(value, ['contract', 'reply', 'practiceCandidate'])
    || value.contract !== DEV_PRACTICE_CONTRACT || !text(value.reply, options.replyMaxChars)) return null;
  let candidate: Readonly<PracticeSuggestion> | null = null;
  let diagnostic: CandidateDiagnosticResult = value.practiceCandidate === null ? 'model_null' : 'candidate_filtered';
  if (value.practiceCandidate !== null) {
    const suggestion = value.practiceCandidate;
    if (!exact(suggestion, ['ifCue', 'thenAction', 'evidence'])
      || !text(suggestion.ifCue, 200) || suggestion.ifCue.length > 200 || !text(suggestion.thenAction, 200) || suggestion.thenAction.length > 200
      || !exact(suggestion.evidence, evidenceKeys)) return null;
    const e = suggestion.evidence;
    if (!text(e.permissionQuote, 1000) || !text(e.anchorQuote, 1000)
      || evidenceKeys.slice(2).some(key => typeof e[key] !== 'boolean')) return null;
    // Missing/negative evidence makes an otherwise valid candidate absent.
    // No intent keywords or turn-count/phase heuristic can turn it back on.
    // Direct current-user requests do not require conversational closure or a
    // separate understanding confirmation. The two legacy observation flags
    // remain schema-checked for wire compatibility, not request eligibility.
    const eligible = e.smallChoiceFits === true
      && e.currentUserRequest === true
      && e.correctionOrRefusalOrExit === false && e.topicChanged === false
      && options.latestUserMessage.includes(e.permissionQuote)
      && options.latestUserMessage.includes(e.anchorQuote);
    if (eligible) candidate = Object.freeze({ ifCue: suggestion.ifCue, thenAction: suggestion.thenAction });
  }
  let reply: string;
  let rejected = false;
  try {
    const outcome = options.validateReply(value.reply);
    reply = typeof outcome === 'string' ? outcome : outcome.text;
    rejected = typeof outcome === 'object' && outcome.rejected;
  } catch { return null; }
  if (options.rejectRewrittenReply && (rejected || reply !== value.reply.trim())) return null;
  if (!text(reply, options.replyMaxChars)) return null;
  // A fact/safety rewrite means the model contract did not pass unchanged.
  // Keep the existing safe reply, but do not expose a suggestion from that output.
  // Strict negotiated recovery already accepts exactly the validator's trim()
  // above. Use that same comparison here; boundary whitespace alone must not
  // silently discard an otherwise eligible suggestion. Legacy behavior stays.
  // A rejected output can equal its fallback byte-for-byte. Preserve the
  // explicit validator decision; string equality alone is not acceptance.
  if (rejected || reply !== (options.rejectRewrittenReply ? value.reply.trim() : value.reply)) candidate = null;
  if (candidate) diagnostic = 'candidate_ready';
  try { options.candidateDiagnostic?.(diagnostic); } catch { /* Diagnostics never decide the response. */ }
  return Object.freeze({ contract: DEV_PRACTICE_CONTRACT, reply, practiceCandidate: candidate,
    source: Object.freeze({ ...options.source }) });
}

/** Scope the unchanged understanding contract to reply, without weakening it. */
export function buildDevPracticeReplyContract(understandingContract: string): string {
  return `本请求使用 ${DEV_PRACTICE_CONTRACT}。只返回一个完整 JSON 对象，顶层仅有 contract、reply、practiceCandidate 三个字段。
contract 固定为 "${DEV_PRACTICE_CONTRACT}"。不要输出 Markdown 围栏、推理、分析步骤或 JSON 之外的文本。
reply 是普通理解文本；下方原合同中的全部事实、安全、长度和句数规则仍严格适用于 reply 字符串，原合同的“不要 JSON”只约束该字符串内部。
===== reply 原合同开始 =====
${understandingContract}
===== reply 原合同结束 =====

practiceCandidate 在缺少必要证据或任何必要条件不满足时为 null。区分用户主动请求与助手主动邀请：用户没有本轮直接许可或请求时，不主动生成候选，也不每轮追问是否愿意练习。禁止根据轮数、阶段、评分或关系层级触发。
当最新这条用户消息中有用户本人无歧义的直接许可或主动请求下一步、有可观察事实锚点、有带宽容纳极小选择，且没有下述排除条件时，应返回一个非 null 候选回应请求，而不是只复述想要练习。不得额外要求先确认理解、先确认模式或对话自然接近结束；用户仍在谈这件事但同时明确请求练习，不因此拒绝候选。不得为满足请求而虚填 evidence，不确定时保持 null。
本轮仅表达行动愿望但没有直接许可或请求、纯陪伴、模糊“怎么办”、沉默或未反对、仅确认模式/理解，都输出 null。主动邀请不能替代用户许可；助手前轮建议或邀请不构成本轮许可。
纠正、否认、拒绝、先停、离开优先；换话题不能继承许可。前轮许可、助手复述、转述别人或台词中的请求，不是用户本轮许可。缺证据就 null。
非 null 候选仅有 ifCue、thenAction、evidence。ifCue 和 thenAction 各不超过200个字符。动作可为 AI 新提出的一个极小可选回应，不能冒充用户已做或说过的事实，不保证效果、不诊断、不安排任务或提醒。
动作短小不等于风险小。练习优先选择可暂停、可撤回、由用户掌控的一步；不得把减少反复检查变成跳过必要的事实、隐私、安全核对，也不得用倒数、限时或“不许修改”等规则催促用户执行有现实后果的动作。不能仅靠“可以”“试着”把这种要求包装为可选建议。
下述质量与安全条件优先于前文“应返回一个非 null 候选”的要求；用户明确请求也不能覆盖这些条件。不能形成符合条件的候选时返回 null，不为满足非空要求降低边界。
发送、提交、删除、付款或作出承诺等动作并非一律禁止，但需要用户提供足够的当前情境，保留必要核对和最终决定权；信息不足时，选择不执行该动作的准备或观察步骤。仍无法给出适合当前情境的低风险小选择时，practiceCandidate 为 null；不要编造“已确认无误”等前提，也不要增设例行确认理解弹框或追问流程。
质量要求同时适用于 thenAction 和 ifCue：不把焦虑或反复检查当作疾病诊断，不设置强迫坚持、不得退出或保证改善的要求。普通可中止的呼吸、观察、整理思路等建议不因出现“停”“检查”“发送”等词就被排除，应按具体含义判断。
evidence 仅有 permissionQuote、anchorQuote、naturalClosing、smallChoiceFits、currentUserRequest、continuingExpression、correctionOrRefusalOrExit、topicChanged。
permissionQuote、anchorQuote 必须逐字引用最新用户消息（保留否定、条件、时间与不确定性），不能从助手或历史消息引用；仅引用并不足以证明许可，必须判断是否是用户本人当前直接请求以及可观察事实。
其余 evidence 字段仍全部必填且为布尔值：naturalClosing 表示自然收束，continuingExpression 表示仍在表达，这两个字段如实记录对话状态，不作为本人本轮明确请求练习的额外门槛。smallChoiceFits 表示能容纳极小选择，currentUserRequest 表示本人本轮直接许可或主动请求，correctionOrRefusalOrExit 表示纠正/拒绝/停止/离开，topicChanged 表示换题。候选仍要求 smallChoiceFits、currentUserRequest 为 true，correctionOrRefusalOrExit、topicChanged 为 false，且两个引用确实来自最新用户消息。任何必要条件不满足则 practiceCandidate 为 null，而不是填充模板。
候选只会被显示为可改写、可拒绝、不保存的 AI 建议。不要声称保存/激活，也不要把建议混入 reply。请求建议不是许可保存、激活、安排提醒或执行动作；这些操作需要用户另行显式选择。只有用户显式保存且保存成功，界面才能说已保存。
无候选时仍提供原合同下的 reply，不添加练习邀约。`;
}
