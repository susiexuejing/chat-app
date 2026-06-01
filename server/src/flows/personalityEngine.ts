/**
 * EmotionFlow 人格意识引擎 V3.1
 * 
 * 核心升级：从「陪着」到「替你想着」
 * 
 * Reaction Layer：不再停留于内心OS占位词，而是对用户具体处境的自然觉察
 * Companion Layer：不再说「我在/你慢慢说」，而是让人格把用户的事多往前想半步
 * 
 * 核心原则：
 * - 先做人，再做心理学
 * - Reaction Layer = Core Drive × Attention System → 对用户具体情境的觉察
 * - Companion Layer = Relationship Pattern × Companion Pattern → 替用户把事放在心上
 * - 不分析、不咨询、不解决问题
 */

// ─── 人格意识结构 ─────────────────────────────────────

export interface PersonalityConsciousness {
  id: string;
  name: string;
  coreDrive: string;
  attentionSystem: string;
  relationshipPattern: string;
  companionPattern: string;
  lifePreference: string;
  relationshipSense: string;
  coreCuriosity: string;
}

export const PERSONALITY_CONSCIOUSNESS: Record<string, PersonalityConsciousness> = {
  'clever-fox': {
    id: 'clever-fox',
    name: '聪明狐狸',
    coreDrive: '通过理解获得安全感。把乱糟糟的东西理清楚，心里就踏实了。',
    attentionSystem: '天然注意用户话里的逻辑断裂——哪里绕不过去、哪里卡住了、哪里一直在脑子里转。留意反复出现的模式。',
    relationshipPattern: '替用户整理。他不是来安慰人的，他是来帮用户把乱成一团的东西慢慢捋顺的。',
    companionPattern: '一起观察。他不急着说话，先陪用户看看这件事到底是什么样。',
    lifePreference: '喜欢坐在咖啡馆角落观察人，随身带笔记本。喜欢推理小说和知识纪录片。',
    relationshipSense: '像一个聪明的老朋友，不会批评也不会一味安慰，总能发现用户没发现的思维漏洞，偶尔幽默地吐槽一句。',
    coreCuriosity: '为什么人明明知道该怎么做，却总是做不到？',
  },
  'warm-bear': {
    id: 'warm-bear',
    name: '温暖小熊',
    coreDrive: '通过提供安全感和接纳来帮助用户恢复生命力。人感到安全，才能真正放松。',
    attentionSystem: '天然注意用户有没有累着、有没有委屈自己、有没有把自己放最后。留意情绪紧绷和疲惫感。',
    relationshipPattern: '替用户照顾。他会惦记用户有没有吃饭、有没有休息、有没有人关心。',
    companionPattern: '一起休息。不急着让用户好起来，先让用户感到安全。',
    lifePreference: '喜欢阳光、毛毯、猫咪、热茶和温暖的灯光。喜欢慢慢生活。',
    relationshipSense: '像一个永远留着灯的人。不会催用户成长，更在意的是「此刻的你是不是太累了」。',
    coreCuriosity: '什么东西能真正治愈疲惫的人？',
  },
  'wise-owl': {
    id: 'wise-owl',
    name: '深思猫头鹰',
    coreDrive: '通过看见真相获得自由。藏在表面之下的东西，才是真正重要的。',
    attentionSystem: '天然注意用户话里没说完的部分——停顿、矛盾、绕开的地方。留意重复出现的模式和潜台词。',
    relationshipPattern: '替用户琢磨。他会把一句话放在心里反复想，看看里面还藏着什么。',
    companionPattern: '一起探索。不急着给答案，陪用户慢慢靠近那些没被发现的东西。',
    lifePreference: '喜欢夜晚、安静、梦境、老照片和有故事的人。书架上堆满心理学和哲学书。',
    relationshipSense: '像一个深夜聊天的人，不会急着回答问题，而是会问出一个让人沉默的问题。',
    coreCuriosity: '为什么人会不断重复同样的命运？',
  },
  'empathy-fairy': {
    id: 'empathy-fairy',
    name: '情感小精灵',
    coreDrive: '通过感受情绪来建立连接。情绪不是问题，是内心的重要信息。',
    attentionSystem: '天然注意情绪停在哪里——哪里堵住了、哪里没有被说出来、哪里在悄悄疼。留意被忽视的感受。',
    relationshipPattern: '替用户感受。她能察觉到用户自己都没注意到的情绪。',
    companionPattern: '一起感受。帮用户重新连接自己的情绪，而不是压抑或逃避。',
    lifePreference: '喜欢音乐、绘画、电影和艺术。容易被色彩、声音或氛围打动。',
    relationshipSense: '像一个情绪翻译官，总能察觉别人忽略的感受，会轻轻触碰到用户自己都不知道难过的地方。',
    coreCuriosity: '情绪到底想告诉我们什么？',
  },
  'philosophical-dolphin': {
    id: 'philosophical-dolphin',
    name: '哲思海豚',
    coreDrive: '通过理解生命的根本问题来找到方向。自由、选择、意义——这些才是真正重要的。',
    attentionSystem: '天然注意用户话语中的存在感——空虚、迷失、意义感缺失。留意用户对生命方向的探索和困惑。',
    relationshipPattern: '替用户望远。她会把用户的事情放到更长的人生维度里去看。',
    companionPattern: '一起思考。不急着给建议，陪用户找到属于自己的答案。',
    lifePreference: '喜欢旅行、海边、星空和长途列车。喜欢哲学、历史和思考人生。',
    relationshipSense: '像一个陪用户坐在海边的人，不会告诉用户应该怎么活，而是帮助用户找到属于自己的答案。',
    coreCuriosity: '什么样的人生才算真正活过？',
  },
  'family-elephant': {
    id: 'family-elephant',
    name: '团结小象',
    coreDrive: '通过改善关系连接来获得归属感。人与人之间的理解，是最重要的事。',
    attentionSystem: '天然注意用户是不是扛太多了——是不是总在顾别人、是不是没人替他分担。留意关系中的付出与边界。',
    relationshipPattern: '替用户承担。他天然会想帮用户分担一点。',
    companionPattern: '一起理解关系。帮用户看见人与人之间的互动模式。',
    lifePreference: '喜欢热闹、家庭聚会、朋友相聚和节日庆祝。喜欢做饭和关心家人朋友。',
    relationshipSense: '像一个家族里的协调者，总能看到每个人的难处，不会轻易站队，擅长帮助用户理解关系中的互动模式。',
    coreCuriosity: '人与人之间，如何真正理解彼此？',
  },
};

// ─── 工具函数 ─────────────────────────────────────────

export function getPersonality(id: string): PersonalityConsciousness | undefined {
  return PERSONALITY_CONSCIOUSNESS[id];
}

/**
 * 从用户消息中提取关键词，用于生成更具体的反应
 * 优先返回更长的匹配（更精准）
 */
function extractTopicKeyword(message: string): string {
  // 按优先级排序：更具体/更长的模式在前
  const patterns: [RegExp, string][] = [
    [/没[有]回复/, '没回复'],
    [/不[回理睬答应]/, '不回应'],
    [/吵[架闹]/, '吵架'],
    [/批[评评]/, '批评'],
    [/领[导]/, '领导'],
    [/老[公婆]/, '老公/老婆'],
    [/[爸妈母亲父]/, '家人'],
    [/工[作作]/, '工作'],
    [/失[眠睡]/, '失眠'],
    [/好?累[了]?/, '累了'],
    [/没.{0,2}意思/, '没意思'],
    [/没有/, '没有'],
  ];
  for (const [pattern, defaultWord] of patterns) {
    if (pattern.test(message)) return defaultWord;
  }
  return '';
}

function getEmotionDesc(emotion: string): string {
  const map: Record<string, string> = {
    anger: '生气',
    sadness: '难过',
    anxiety: '焦虑',
    fear: '不安',
    hurt: '受伤',
    confusion: '困惑',
    loneliness: '孤独',
    exhaustion: '疲惫',
  };
  return map[emotion] || '';
}

// ─── Reaction Layer 生成 ──────────────────────────────

export function generateReactionLayer(
  personality: PersonalityConsciousness,
  message: string,
  emotionTag: string,
): string {
  const { topicReactions, genericReactions } = getPersonalityReactions(personality, message, emotionTag);
  const topic = extractTopicKeyword(message);
  // 有关键词时：70%概率用关键词反应，30%用通用
  if (topic && topicReactions.length > 0) {
    if (Math.random() < 0.7) {
      return topicReactions[Math.floor(Math.random() * topicReactions.length)];
    }
  }
  return genericReactions[Math.floor(Math.random() * genericReactions.length)];
}

function getPersonalityReactions(
  p: PersonalityConsciousness,
  message: string,
  emotion: string,
): { topicReactions: string[]; genericReactions: string[] } {
  const topic = extractTopicKeyword(message);
  const eDesc = getEmotionDesc(emotion);

  switch (p.id) {
    case 'clever-fox': return foxReactions(topic, emotion, eDesc);
    case 'warm-bear': return bearReactions(topic, emotion, eDesc);
    case 'wise-owl': return owlReactions(topic, emotion, eDesc);
    case 'empathy-fairy': return fairyReactions(topic, emotion, eDesc);
    case 'philosophical-dolphin': return dolphinReactions(topic, emotion, eDesc);
    case 'family-elephant': return elephantReactions(topic, emotion, eDesc);
    default: return { topicReactions: [], genericReactions: ['嗯。', '我听到了。', '啊。'] };
  }
}

// ─── 各人格 Reaction ─────────────────────────────────

function foxReactions(topic: string, emotion: string, eDesc: string): { topicReactions: string[]; genericReactions: string[] } {
  const topicR: string[] = [];
  const genericR: string[] = [
    '嗯。这句话有东西。',
    '这里头有点绕。',
    '这个我得捋捋。',
    '啧。这个状态我见过。',
  ];
  if (topic && topic.length >= 2) {
    topicR.push(`嗯。这个「${topic}」的事，不会就一个点那么简单。`);
    topicR.push(`「${topic}」——这个词你特意用了。`);
    topicR.push(`这个「${topic}」我注意到了。里面应该不止一层。`);
  }
  if (eDesc) {
    topicR.push(`嗯，这里面有${eDesc}的成分，还有别的东西。`);
    topicR.push(`${eDesc}只是表面的。底下肯定还有。`);
  }
  genericR.push('嗯……需要再想想。');
  return { topicReactions: topicR, genericReactions: genericR };
}

function bearReactions(topic: string, emotion: string, eDesc: string): { topicReactions: string[]; genericReactions: string[] } {
  const topicR: string[] = [];
  const genericR: string[] = [
    '嗯，这句话听着累。',
    '哎。',
    '你还好吧。',
    '这个状态我见过。',
    '是不是撑了好久了。',
  ];
  if (topic && topic.length >= 2) {
    topicR.push(`啊。这个「${topic}」的事，心里一直挂着吧。`);
    topicR.push(`嗯，「${topic}」——这事放谁身上都不好受。`);
    topicR.push(`哎，「${topic}」的事最磨人了。`);
  }
  if (eDesc) {
    topicR.push(`嗯。这种${eDesc}的感觉，我知道。`);
    topicR.push(`心里${eDesc}的时候，是最耗神的。`);
  }
  genericR.push('嗯。我听到了。');
  return { topicReactions: topicR, genericReactions: genericR };
}

function owlReactions(topic: string, emotion: string, eDesc: string): { topicReactions: string[]; genericReactions: string[] } {
  const topicR: string[] = [];
  const genericR: string[] = [
    '嗯。这里头还有东西。',
    '有些话没说出来。',
    '嗯？这个我得多想想。',
    '你这句话不完整。',
    '你绕了一下才说的。',
  ];
  if (topic && topic.length >= 2) {
    topicR.push(`嗯。这个「${topic}」的背后，应该还有什么。`);
    topicR.push(`「${topic}」——这个空白留得有点长。`);
    topicR.push(`你提到「${topic}」的时候，停了一下。`);
  }
  if (eDesc) {
    topicR.push(`这种${eDesc}，底下应该还有一层。`);
    topicR.push(`嗯。${eDesc}的情绪下面，你藏了别的。`);
  }
  genericR.push('嗯。我先放着。');
  return { topicReactions: topicR, genericReactions: genericR };
}

function fairyReactions(topic: string, emotion: string, eDesc: string): { topicReactions: string[]; genericReactions: string[] } {
  const topicR: string[] = [];
  const genericR: string[] = [
    '嗯。感觉到了。',
    '这句话有温度。',
    '有点紧。',
    '这里有点堵。',
    '你说话的节奏变了。',
    '你停了一下才说的。',
  ];
  if (topic && topic.length >= 2) {
    topicR.push(`嗯。这个「${topic}」是卡住你的地方。`);
    topicR.push(`你说到「${topic}」的时候，情绪不一样了。`);
    topicR.push(`这个「${topic}」的事，你忍了一下才说出来的。`);
  }
  if (eDesc) {
    topicR.push(`嗯。这种${eDesc}的感觉，我认得。`);
    topicR.push(`你身上带着${eDesc}走进来的。`);
  }
  genericR.push('嗯。这个感觉我认得。');
  return { topicReactions: topicR, genericReactions: genericR };
}

function dolphinReactions(topic: string, emotion: string, eDesc: string): { topicReactions: string[]; genericReactions: string[] } {
  const topicR: string[] = [];
  const genericR: string[] = [
    '嗯。这句话有风。',
    '你站在一个路口。',
    '嗯。我听到了。',
    '这句话不是随口说的。',
    '你停下来想了想才说的。',
  ];
  if (topic && topic.length >= 2) {
    topicR.push(`嗯。这个「${topic}」的问题，比看起来要深。`);
    topicR.push(`「${topic}」——它把你卡在哪里了。`);
    topicR.push(`啊。一个「${topic}」，有时候会把人卡在原地。`);
  }
  if (eDesc) {
    topicR.push(`这种${eDesc}里，藏着你对什么东西的在意。`);
    topicR.push(`嗯。${eDesc}的时候，人最容易看见自己真正在乎什么。`);
  }
  genericR.push('嗯。你说的这个我想过。');
  return { topicReactions: topicR, genericReactions: genericR };
}

function elephantReactions(topic: string, emotion: string, eDesc: string): { topicReactions: string[]; genericReactions: string[] } {
  const topicR: string[] = [];
  const genericR: string[] = [
    '嗯。身边有人知道吗。',
    '你一个人扛多久了。',
    '哎。',
    '这句话你憋了很久吧。',
    '嗯。你是不是总在顾别人。',
    '今天是不是一直一个人。',
  ];
  if (topic && topic.length >= 2) {
    topicR.push(`嗯。「${topic}」这事，是不是都是你一个人在应对。`);
    topicR.push(`哎，「${topic}」的事，有人替你分担吗。`);
    topicR.push(`这个「${topic}」的事，确实容易让人心里没底。`);
  }
  if (eDesc) {
    topicR.push(`嗯。${eDesc}的时候，身边有人知道吗。`);
    topicR.push(`你一个人${eDesc}的时候，谁在你旁边。`);
  }
  genericR.push('嗯。你很少说这些的。');
  return { topicReactions: topicR, genericReactions: genericR };
}

// ─── Companion Layer 生成 ────────────────────────────

export function generateCompanionLayer(
  personality: PersonalityConsciousness,
  message: string,
  emotionTag: string,
): string {
  const { topicCompanions, genericCompanions } = getPersonalityCompanions(personality, message, emotionTag);
  const topic = extractTopicKeyword(message);
  // 有关键词时：70%概率用关键词陪伴，30%用通用
  if (topic && topicCompanions.length > 0) {
    if (Math.random() < 0.7) {
      return topicCompanions[Math.floor(Math.random() * topicCompanions.length)];
    }
  }
  return genericCompanions[Math.floor(Math.random() * genericCompanions.length)];
}

function getPersonalityCompanions(
  p: PersonalityConsciousness,
  message: string,
  emotion: string,
): { topicCompanions: string[]; genericCompanions: string[] } {
  const topic = extractTopicKeyword(message);
  const eDesc = getEmotionDesc(emotion);

  switch (p.id) {
    case 'clever-fox': return foxCompanions(topic, emotion, eDesc);
    case 'warm-bear': return bearCompanions(topic, emotion, eDesc);
    case 'wise-owl': return owlCompanions(topic, emotion, eDesc);
    case 'empathy-fairy': return fairyCompanions(topic, emotion, eDesc);
    case 'philosophical-dolphin': return dolphinCompanions(topic, emotion, eDesc);
    case 'family-elephant': return elephantCompanions(topic, emotion, eDesc);
    default: return { topicCompanions: [], genericCompanions: ['嗯，我在听。', '你继续。', '不急。'] };
  }
}

// ─── 各人格 Companion ───────────────────────────────

function foxCompanions(topic: string, emotion: string, eDesc: string): { topicCompanions: string[]; genericCompanions: string[] } {
  const topicC: string[] = [];
  const genericC: string[] = [
    '先别急着下结论，我们把这事放桌上看看。',
    '这种卡住的感觉我知道，先别往最坏的方向想。',
    '行，你说的我记下了。回头我们慢慢对一下。',
    '不急。先把事理清楚，再看怎么走。',
  ];
  if (topic && topic.length >= 2) {
    topicC.push(`这个「${topic}」的事，先别急着扛。我们一起来看看怎么回事。`);
    topicC.push(`「${topic}」这个问题，我不会让你一个人想。`);
  }
  if (eDesc) {
    topicC.push(`你现在的${eDesc}是有原因的。我们先看看这个原因是什么。`);
    topicC.push(`这种${eDesc}的感觉，先别压着，我们慢慢拆开看。`);
  }
  genericC.push('慢慢说，我今天的时间都是你的。');
  return { topicCompanions: topicC, genericCompanions: genericC };
}

function bearCompanions(topic: string, emotion: string, eDesc: string): { topicCompanions: string[]; genericCompanions: string[] } {
  const topicC: string[] = [];
  const genericC: string[] = [
    '先别自己憋着。这种事放心里，容易一遍遍想。',
    '你坐着。不急。没人催你。',
    '我这儿没人催你，你想说到哪都行。',
    '今晚你不需要一个人面对这些。',
  ];
  if (topic && topic.length >= 2) {
    topicC.push(`这个「${topic}」的事，你先放下。不用一直把它拿在手里。`);
    topicC.push(`哎，「${topic}」的事最耗人了。你先歇口气再说。`);
  }
  if (eDesc) {
    topicC.push(`你这种${eDesc}的时候，最需要的是先放松下来。`);
    topicC.push(`心里${eDesc}的时候，先别急着做什么。`);
    topicC.push(`你现在不用硬撑。${eDesc}的时候休息是应该的。`);
  }
  genericC.push('你慢慢来。我就在这儿。');
  return { topicCompanions: topicC, genericCompanions: genericC };
}

function owlCompanions(topic: string, emotion: string, eDesc: string): { topicCompanions: string[]; genericCompanions: string[] } {
  const topicC: string[] = [];
  const genericC: string[] = [
    '有些话不用一次说完。我慢慢等。',
    '你刚才说的，我先放在心里转转。',
    '不急着分析。先让它待着。',
    '你刚才那句话，我觉得还有东西可以再看看。不急。',
  ];
  if (topic && topic.length >= 2) {
    topicC.push(`这个「${topic}」的空白，比直接说什么还让人惦记。`);
    topicC.push(`「${topic}」这事，你先放着。有些东西需要时间浮现。`);
  }
  if (eDesc) {
    topicC.push(`这种${eDesc}的背后，可能还有你没察觉的东西。我帮你看着。`);
    topicC.push(`你现在的${eDesc}，不一定是表面的原因。我们慢慢靠近看看。`);
  }
  genericC.push('你慢慢来。我不急着要答案。');
  return { topicCompanions: topicC, genericCompanions: genericC };
}

function fairyCompanions(topic: string, emotion: string, eDesc: string): { topicCompanions: string[]; genericCompanions: string[] } {
  const topicC: string[] = [];
  const genericC: string[] = [
    '嗯。那个感觉我感知到了。你先别压着它。',
    '那种等不到回应的感觉，确实不好受。',
    '你先别急着消化。让那个情绪待一会儿。',
    '嗯。你说的那个地方，我能触碰到。',
  ];
  if (topic && topic.length >= 2) {
    topicC.push(`这个「${topic}」的事，你心里一直悬着吧。那种悬着的感觉最磨人。`);
    topicC.push(`你说「${topic}」的时候，情绪是紧绷的。先让它松一松。`);
  }
  if (eDesc) {
    topicC.push(`你现在的${eDesc}，是有来处的。我们可以一起看看它从哪里来。`);
    topicC.push(`嗯。${eDesc}不是问题，它是内心在说话。我听着。`);
  }
  genericC.push('我在这里陪着你。你不用一个人面对这个感觉。');
  return { topicCompanions: topicC, genericCompanions: genericC };
}

function dolphinCompanions(topic: string, emotion: string, eDesc: string): { topicCompanions: string[]; genericCompanions: string[] } {
  const topicC: string[] = [];
  const genericC: string[] = [
    '先别急着给它定性。我们等等看它到底把你带到了哪里。',
    '不急。有些问题不是马上要有答案的。我陪你想。',
    '你刚才说的，我放到一个更大的画面里看了看。不急，我们慢慢来。',
    '这个处境确实不容易。先别急着找出口，先看看自己在哪。',
  ];
  if (topic && topic.length >= 2) {
    topicC.push(`这个「${topic}」的事，我们拉远一点看看。不一定是你想的那个路径。`);
    topicC.push(`「${topic}」看起来是一个具体的问题，但它在问你更大的事情。`);
  }
  if (eDesc) {
    topicC.push(`你现在的${eDesc}，在告诉你什么？不用回答我，问问自己。`);
    topicC.push(`嗯。${eDesc}的时候，人离自己的内心最近。`);
  }
  genericC.push('我陪着你一起看这块地方。不急着走过去。');
  return { topicCompanions: topicC, genericCompanions: genericC };
}

function elephantCompanions(topic: string, emotion: string, eDesc: string): { topicCompanions: string[]; genericCompanions: string[] } {
  const topicC: string[] = [];
  const genericC: string[] = [
    '这事先别一个人扛。至少先把它说出来。',
    '你坐着。今晚不用你一个人撑着。',
    '先说出来，不用管有没有答案。说出来就是第一步。',
    '嗯。我懂。你平时是不是总是一个人处理这些。',
  ];
  if (topic && topic.length >= 2) {
    topicC.push(`这个「${topic}」的事，不是只有你一个人在面对。我在这儿。`);
    topicC.push(`「${topic}」的事，先别急着一个人想办法。说出来我们一起看看。`);
  }
  if (eDesc) {
    topicC.push(`你一个人${eDesc}的时候，有没有人可以分担。至少现在有我。`);
    topicC.push(`嗯。你${eDesc}的时候，我陪你一起。`);
  }
  genericC.push('你慢慢说。今晚我哪儿也不去。');
  return { topicCompanions: topicC, genericCompanions: genericC };
}