/**
 * 用户状态检测 + 关键词提取
 * 基于规则匹配，不依赖 AI
 */

export type UserState =
  | 'anger'
  | 'sadness'
  | 'anxiety'
  | 'body_tension'
  | 'self_doubt'
  | 'relationship_conflict'
  | 'attachment_anxiety'
  | 'helplessness'
  | 'general';

/**
 * 检测用户当前情绪/状态
 * 优先级从上到下：匹配到第一个即返回
 */
export function detectUserState(message: string): UserState {
  const m = message;

  // ── 1. 身体紧绷（最具体，优先匹配） ──
  if (
    /肩膀[紧绷紧沉]|胸口[堵闷痛紧]|喘不过气|身体[绷紧硬]|胃[里口][沉堵紧]|浑身[紧绷]|肌肉[紧绷酸]|心跳[加快加速快]|手[抖颤]|头[疼痛晕]|睡不好|失眠|放松[不了不下]/.test(m)
  ) {
    return 'body_tension';
  }

  // ── 2. 依恋焦虑（在 anxiety 之前，避免被通用焦虑覆盖） ──
  if (
    /怕被丢下|不理我|是不是[我]说错|是不是我不好|他是不是[讨厌烦嫌弃不理]|是不是不喜欢[我了]|嫌我|抛弃|不回了|没回我|已读不回|冷落[我了]？|太粘人|疏远|冷淡[了我]？|不搭理[我]|躲着我|不爱[我了]|不要我了|被丢下/.test(m)
  ) {
    return 'attachment_anxiety';
  }

  // ── 3. 愤怒/生气 ──
  if (
    /生气|愤怒|火大|气死|发火|暴躁|烦死了|受不了|忍不了|爆炸|很气/.test(m)
  ) {
    return 'anger';
  }

  // ── 4. 无力/无助（control_to_helplessness） ──
  if (
    /都没用|改变不了|没办法|无能为力|试[了过]很多|都[试过]了|只能这样|已经尽力|算了|白费|徒劳|无[能为力]|不管用|努力[了过]也没[用结果]|不知道怎么办|绝望/.test(m)
  ) {
    return 'helplessness';
  }

  // ── 5. 自我怀疑（增强） ──
  if (
    /不够好|我很差|很差|自责|内耗|讨厌自己|看不起|没用|失败|不够努力|我真差|我不行|我做不到|自卑|是不是我错了|我做错什么|我太差|都是我的问题|我好差|我不好|都是我[的]错|什么都做不好/.test(m)
  ) {
    return 'self_doubt';
  }

  // ── 6. 焦虑/担心 ──
  if (
    /焦虑|担心|害怕|不安|紧张|恐慌|心慌|睡不着|胡思乱想|停不下来|想太多|好难|压力大/.test(m)
  ) {
    return 'anxiety';
  }

  // ── 7. 关系冲突（不含已在上方捕获的依恋焦虑） ──
  if (
    /老公|老婆|伴侣|男?女朋友|恋爱|冷战|离婚|分手|父母|婆婆|孩子|吵架|误会|矛盾|冲突/.test(m)
  ) {
    return 'relationship_conflict';
  }

  // ── 8. 难过/悲伤 ──
  if (
    /难过|委屈|想哭|失落|伤心|悲伤|沮丧|心痛|心累|没劲|没力气|不开心|孤独|寂寞|好累/.test(m)
  ) {
    return 'sadness';
  }

  return 'general';
}

/**
 * 从用户输入中提取 1-2 个关键短语
 * 通过标点分词 + 取最长的有意义的片段
 */
export function extractKeywords(message: string): string[] {
  // 先按常见分隔符切分
  const separators = /[，。！？、；：\n\r,.!?;:]/;
  const segments = message.split(separators).map(s => s.trim()).filter(s => s.length >= 2);

  // 按长度降序排列，取最长2段
  const sorted = [...new Set(segments)].sort((a, b) => b.length - a.length);

  const result: string[] = [];
  for (const seg of sorted) {
    if (result.length >= 2) break;
    // 限制单个关键词长度在 5-20 字之间
    const clean = seg.replace(/[「」""''『』]/g, '').trim();
    if (clean.length >= 2 && clean.length <= 25) {
      result.push(clean);
    } else if (clean.length > 25) {
      // 太长就截取前 20 字
      result.push(clean.slice(0, 20));
    }
  }

  // 如果切分后不足2个，尝试用主谓结构提取
  if (result.length === 0) {
    // 移除语气词后取整个句子
    const cleaned = message.replace(/[啊吧吗呢呀哦嗯]/, '').trim();
    if (cleaned.length > 0) {
      result.push(cleaned.length > 20 ? cleaned.slice(0, 20) : cleaned);
    }
  }

  if (result.length === 1 && message.length > 10) {
    // 尝试从剩余部分提取第二个关键词
    const remaining = message.replace(result[0], '').trim();
    const sub = remaining.replace(/[，。！？、；：\n\r]/g, '').trim();
    if (sub.length >= 2) {
      result.push(sub.length > 20 ? sub.slice(0, 20) : sub);
    }
  }

  // 最少保证1个
  if (result.length === 0) {
    result.push('你刚才说的情况');
  }

  return result.slice(0, 2);
}