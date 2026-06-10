/**
 * 情绪与事件关键词识别模块
 * 基于关键词匹配，识别用户输入中的情绪和事件标签
 */

import type { EmotionTag, EventTag } from './frontFlows';

// 情绪关键词映射
const emotionKeywords: Record<EmotionTag, string[]> = {
  anger: ['生气', '愤怒', '发火', '气死', '火大', '恼火', '烦', '暴躁', '怒火', '不爽', '怒', '气愤', '气的', '气坏了'],
  sadness: ['难过', '伤心', '悲伤', '哭', '流泪', '心碎', '失落', '悲痛', '哀伤', '忧郁', '沮丧', '心酸', '难受', '痛苦', '不开心'],
  anxiety: ['焦虑', '紧张', '不安', '担心', '害怕', '慌', '恐惧', '恐慌', '忐忑', '惶恐', '心惊', '担忧', '怕'],
  loneliness: ['孤独', '孤单', '寂寞', '一个人', '没人懂', '没人理解', '被冷落', '被孤立', '没人陪', '独自'],
  guilt: ['内疚', '愧疚', '自责', '对不起', '是我的错', '后悔', '懊悔', '罪过', '有愧', '抱歉', '对不住'],
  fear: ['害怕', '恐惧', '吓', '心惊', '胆战', '恐怖', '不安', '担心', '怕'],
  confusion: ['迷茫', '困惑', '不知道怎么办', '不懂', '糊涂', '混乱', '想不通', '不明白', '搞不懂', '迷惑'],
  hurt: ['受伤', '伤心', '心寒', '委屈', '被伤害', '欺负', '被背叛', '被欺骗', '被辜负', '寒心', '刺痛'],
  attachment_anxiety: ['没回我', '已读不回', '不理我', '不回', '冷淡', '疏远', '怕被丢下', '抛弃', '被丢下', '是不是烦我', '是不是不喜欢我', '是不是我说错', '是不是我不好', '太粘人', '粘人', '被冷落', '冷落我', '嫌我', '不回了'],
  helplessness: ['都没用', '没办法', '改变不了', '无能为力', '只能这样', '试了很多办法', '已经尽力了', '算了', '就这样吧', '白费力气', '徒劳', '没救了', '没用'],
  general: [],
};

// 事件关键词映射
const eventKeywords: Record<EventTag, string[]> = {
  'relationship_conflict': ['老公', '老婆', '男朋友', '女朋友', '男友', '女友', '爱人', '伴侣', '对象', '吵架', '冷战', '分手', '离婚', '闹矛盾', '争执', '争吵', '矛盾', '相处', '感情', '恋人', '夫妻', '婚姻', '配偶', '结婚', '相亲'],
  'work_stress': ['工作', '加班', '老板', '同事', '上司', '领导', '压力', '辞职', '裁员', '职场', '打工', '升职', '工资', '绩效', 'KPI', '项目', '业务', '客户', '甲方', '乙方', '上班', '职业', '行业'],
  'family_issue': ['家人', '父母', '爸爸', '妈妈', '父亲', '母亲', '孩子', '儿子', '女儿', '兄弟姐妹', '亲戚', '家庭', '家里', '家族', '长辈', '孝顺', '逼婚', '催婚', '代沟', '娘家', '婆家', '公公', '婆婆'],
  'self_doubt': ['不够好', '不行', '失败', '没用', '自卑', '无能', '差劲', '不如', '配不上', '否定', '怀疑自己', '没自信', '不自信', '觉得自己差', '没能力', '低人一等'],
  'grief': ['去世', '离开', '逝去', '失去', '追悼', '葬礼', '离别', '永别', '悼念', '丧', '故人', '天堂', '思念', '怀念', '走了', '不在了', '过世'],
  'loneliness_event': ['没朋友', '社交', '社恐', '格格不入', '不合群', '融入', '交朋友', '圈子', '人际', '边缘', '被排挤', '被孤立', '没话说', '孤单'],
  general: [],
};

/**
 * 识别人工智能消息中的情绪标签
 */
export function recognizeEmotion(message: string): EmotionTag {
  const lowerMsg = message;
  
  // 按优先级检查：先检查具体情绪，再回退到 general
  const priority: EmotionTag[] = ['anger', 'sadness', 'anxiety', 'loneliness', 'guilt', 'fear', 'confusion', 'hurt'];
  
  for (const emotion of priority) {
    const keywords = emotionKeywords[emotion];
    if (keywords.some(kw => lowerMsg.includes(kw))) {
      return emotion;
    }
  }
  
  return 'general';
}

/**
 * 识别事件标签
 */
export function recognizeEvent(message: string): EventTag {
  const lowerMsg = message;
  
  const priority: EventTag[] = ['relationship_conflict', 'work_stress', 'family_issue', 'self_doubt', 'grief', 'loneliness_event'];
  
  for (const event of priority) {
    const keywords = eventKeywords[event];
    if (keywords.some(kw => lowerMsg.includes(kw))) {
      return event;
    }
  }
  
  return 'general';
}

/**
 * 单次识别结果
 */
export interface RecognitionResult {
  emotion: EmotionTag;
  event: EventTag;
}

/**
 * 完整识别
 */
export function recognize(message: string): RecognitionResult {
  return {
    emotion: recognizeEmotion(message),
    event: recognizeEvent(message),
  };
}