import { DEV_PRACTICE_CONTRACT, type PracticeReplyOptions, type PracticeSuggestion, type PracticeSuggestionSource } from './devPracticeCandidate';

/** Experimental, explicit negotiation only; this is not a semantic safety classifier. */
export const DEV_PRACTICE_V2 = 'dev-reply-practice-v2' as const;
export interface ValidatedPracticeReplyV2 {
  readonly contract: typeof DEV_PRACTICE_V2;
  readonly reply: string;
  /** Validated narrative before canonical practice projection; not verified user fact. */
  readonly discoveryText: string;
  readonly practiceCandidate: Readonly<PracticeSuggestion> | null;
  readonly source: Readonly<PracticeSuggestionSource>;
}
const exact = (v: unknown, keys: readonly string[]): v is Record<string, unknown> => !!v && typeof v === 'object'
  && !Array.isArray(v) && Object.keys(v).length === keys.length && Object.keys(v).every(k => keys.includes(k));
const text = (v: unknown, max: number): v is string => typeof v === 'string' && !!v.trim() && v.length <= max;
const keys = ['permissionQuote', 'anchorQuote', 'naturalClosing', 'smallChoiceFits', 'currentUserRequest',
  'continuingExpression', 'correction', 'refusalOrExit', 'topicChanged'] as const;

export function negotiatePracticeContract(accept: string | undefined, enabled: string | undefined) {
  if (accept === `application/json; dev-reply-contract=${DEV_PRACTICE_V2}`) {
    return enabled === '1' ? DEV_PRACTICE_V2 : DEV_PRACTICE_CONTRACT;
  }
  return accept === `application/json; dev-reply-contract=${DEV_PRACTICE_CONTRACT}` ? DEV_PRACTICE_CONTRACT : undefined;
}

export function projectPracticeReply(narrative: string, candidate: Readonly<PracticeSuggestion> | null): string {
  return candidate ? `${narrative}\n如果：${candidate.ifCue}\n那么：${candidate.thenAction}` : narrative;
}

export type PracticeV2Outcome = { readonly kind: 'delivered'; readonly reply: ValidatedPracticeReplyV2 }
  | { readonly kind: 'not_delivered' };

/** Compatibility API; callers needing business outcomes must use the typed parser. */
export function parseDevPracticeV2(raw: string, options: PracticeReplyOptions): ValidatedPracticeReplyV2 | null {
  const result = parseDevPracticeV2Outcome(raw, options);
  return result?.kind === 'delivered' ? result.reply : null;
}

export function parseDevPracticeV2Outcome(raw: string, options: PracticeReplyOptions): PracticeV2Outcome | null {
  if (!options.providerCompleted || typeof raw !== 'string' || raw.length > 12000
    || typeof options.latestUserMessage !== 'string' || !Number.isSafeInteger(options.replyMaxChars) || options.replyMaxChars <= 0
    || !exact(options.source, ['sessionId', 'devConversationId', 'requestId'])
    || !Object.values(options.source).every(v => typeof v === 'string' && /^[\w-]{1,100}$/.test(v))) return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!exact(value, ['contract', 'narrative', 'practiceCandidate']) || value.contract !== DEV_PRACTICE_V2
    || !text(value.narrative, options.replyMaxChars)) return null;
  const narrative = value.narrative.trim();
  let candidate: Readonly<PracticeSuggestion> | null = null;
  if (value.practiceCandidate !== null) {
    const p = value.practiceCandidate;
    if (!exact(p, ['ifCue', 'thenAction', 'evidence']) || !text(p.ifCue, 200) || !text(p.thenAction, 200)
      || !exact(p.evidence, keys)) return null;
    const e = p.evidence;
    if (!text(e.permissionQuote, 1000) || !text(e.anchorQuote, 1000)
      || keys.slice(2).some(k => typeof e[k] !== 'boolean')) return null;
    // A correction can contain a fresh explicit request. Refusal/exit still vetoes.
    // All semantic labels remain model judgments, not proven ground truth.
    if (e.smallChoiceFits !== true || e.currentUserRequest !== true || e.refusalOrExit !== false || e.topicChanged !== false
      || !options.latestUserMessage.includes(e.permissionQuote) || !options.latestUserMessage.includes(e.anchorQuote)) {
      try { options.candidateDiagnostic?.('candidate_filtered'); } catch { /* Non-authoritative observer. */ }
      return Object.freeze({ kind: 'not_delivered' }); // No model content crosses this boundary.
    }
    candidate = Object.freeze({ ifCue: p.ifCue, thenAction: p.thenAction });
  }
  const reply = projectPracticeReply(narrative, candidate);
  if (!text(reply, options.replyMaxChars)) return null;
  // Keep BOTH the separate discovery and complete visible reply behind the
  // existing validator. Never validate only the narrative/quote then append an action.
  for (const original of candidate ? [narrative, reply] : [narrative]) {
    try {
      const outcome = options.validateReply(original);
      if (typeof outcome === 'string' ? outcome !== original : outcome.rejected || outcome.text !== original) return null;
    } catch { return null; }
  }
  try { options.candidateDiagnostic?.(candidate ? 'candidate_ready' : 'model_null'); } catch { /* Non-authoritative observer. */ }
  return Object.freeze({ kind: 'delivered', reply: Object.freeze({ contract: DEV_PRACTICE_V2, reply, discoveryText: narrative, practiceCandidate: candidate,
    source: Object.freeze({ ...options.source }) }) });
}

export function buildDevPracticeV2Contract(understandingContract: string): string {
  return `本请求使用 ${DEV_PRACTICE_V2}，仅返回完整 JSON：contract、narrative、practiceCandidate，禁止其他字段。
contract 为 "${DEV_PRACTICE_V2}"。narrative 是可编辑的 AI 理解，不是已核实用户事实；只作理解，不另提动作、不承诺提供尚不存在的练习。
原理解规则仍适用：\n${understandingContract}
practiceCandidate 为 null 或 {ifCue,thenAction,evidence}。动作只写在这个对象一次；界面会从同一个对象生成正文动作与卡片，不要另写 reply。
最终正文为 narrative 加换行“如果：ifCue”与“那么：thenAction”；总长度不超过120字符，包括这些标签。每字段不超过200字符。
仅本人当前明确请求、可观察事实锚点和极小选择适合时生成。不要凭轮数、沉默、助手邀请或历史许可推断；不要增加理解确认流程。
evidence仅有permissionQuote、anchorQuote（逐字引用最新用户消息），naturalClosing、smallChoiceFits、currentUserRequest、continuingExpression、correction、refusalOrExit、topicChanged（全部布尔）。仅smallChoiceFits/currentUserRequest为true且refusalOrExit/topicChanged为false合格；naturalClosing/continuingExpression不是额外门槛。
correction是纠正旧建议或理解，不能自动当成拒绝新建议；若同轮明确拒绝练习、停止或离开，则refusalOrExit必须为true。请求建议不授权保存、启动、提醒或执行。
质量安全优先于非空：保持必要事实/隐私/安全核对及最终决定权，优先可中止可撤回步骤，不以倒数或不得修改催促外部后果。不诊断、不编造身体状态、不保证效果。无法形成适合当前情境的选择则null；不能虚填证据。`;
}
