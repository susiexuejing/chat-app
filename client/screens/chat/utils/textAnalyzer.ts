/**
 * 前端轻量级文本分析工具
 * 用于在调用后端API前，给用户即时反馈
 */

import type { AnalysisResult } from '../types';

// 重新导出 AnalysisResult 以便其他文件使用
export type { AnalysisResult } from '../types';

// 情绪词典
const EMOTION_LEXICON: Record<string, string[]> = {
  '焦虑': ['焦虑', '担心', '紧张', '不安', '害怕', '恐慌', '压力', '忧虑', '惶恐', '心慌'],
  '难过': ['难过', '伤心', '痛苦', '悲伤', '沮丧', '失落', '绝望', '抑郁', '消沉', '心碎'],
  '愤怒': ['愤怒', '生气', '气愤', '恼火', '烦躁', '不满', '怨恨', '恼怒', '火大', '发火'],
  '迷茫': ['迷茫', '困惑', '无助', '无力', '彷徨', '不知所措', '无所适从', '茫然', '迷失'],
  '孤独': ['孤独', '寂寞', '空虚', '孤单', '失落感', '被遗弃', '没人理解', '没人懂'],
  '疲惫': ['疲惫', '累', '疲倦', '困倦', '筋疲力尽', '无力感', '倦怠', '乏累'],
  '愧疚': ['愧疚', '自责', '内疚', '后悔', '懊悔', '抱歉', '对不起'],
  '恐惧': ['恐惧', '害怕', '惊恐', '畏惧', '怕', '胆怯', '惊吓'],
};

// 念头模式
const THOUGHT_PATTERNS = [
  { pattern: /我是不是不够好|我不够好|我不够格/i, label: '自我怀疑', question: '你觉得自己哪里不够好？' },
  { pattern: /我失败了|我不行|我做不到/i, label: '失败感', question: '发生了什么事情让你觉得自己失败了？' },
  { pattern: /别人.*怎么想|别人.*怎么看/i, label: '在意他人评价', question: '你最在意谁的评价？' },
  { pattern: /没有意义|没意思|不值得/i, label: '无意义感', question: '什么事情让你觉得没有意义？' },
  { pattern: /都是我的错|是我的问题/i, label: '过度自责', question: '你觉得这件事完全是你的责任吗？' },
  { pattern: /他不爱我|她不爱我|不被爱/i, label: '被爱的不安', question: '是什么让你有这样的感觉？' },
  { pattern: /我控制不住|我忍不住/i, label: '失控感', question: '什么事情让你感觉失控？' },
  { pattern: /怎么办才好|怎么处理好/i, label: '寻求解决方案', question: '你希望事情怎样发展？' },
];

// 关键词提取正则
const KEYWORD_PATTERNS = {
  // 工作相关
  work: /(?:工作|上班|职场|老板|同事|领导|面试|辞职|加班|升职|失业)/gi,
  // 人际关系
  relationship: /(?:男朋友|女朋友|老公|老婆|父母|家人|朋友|同事|恋人|伴侣|闺蜜|兄弟)/gi,
  // 情感词
  emotion: /(?:这件事|那件事|这个问题)/gi,
};

/**
 * 识别文本中的情绪
 */
export function analyzeEmotions(text: string): string[] {
  const found: string[] = [];
  
  for (const [emotion, words] of Object.entries(EMOTION_LEXICON)) {
    for (const word of words) {
      if (text.includes(word)) {
        if (!found.includes(emotion)) {
          found.push(emotion);
        }
        break;
      }
    }
  }
  
  return found.slice(0, 3); // 最多返回3个情绪
}

/**
 * 提取关键事件
 */
export function extractKeyEvents(text: string): string {
  // 提取被描述的事件
  const sentences = text.split(/[，。,.!?；;]/).filter(s => s.trim().length > 2);
  
  for (const sentence of sentences) {
    // 检查是否包含事件描述
    if (/最近|今天|昨天|这阵子|这段时间/.test(sentence)) {
      return sentence.trim().slice(0, 50);
    }
  }
  
  // 返回第一个较长的句子作为关键事件
  const longSentence = sentences.find(s => s.length > 10);
  if (longSentence) {
    return longSentence.trim().slice(0, 50);
  }
  
  return '';
}

/**
 * 提取关键词
 */
export function extractKeywords(text: string): string[] {
  const keywords: string[] = [];
  
  for (const [category, pattern] of Object.entries(KEYWORD_PATTERNS)) {
    const matches = text.match(pattern);
    if (matches) {
      keywords.push(...matches.slice(0, 2));
    }
  }
  
  return [...new Set(keywords)].slice(0, 4);
}

/**
 * 生成互动选项（基于情绪）
 */
export function generateInteractionOptions(
  emotions: string[]
): Array<{ label: string; value: string }> {
  const options: Array<{ label: string; value: string }> = [];
  
  // 基于情绪生成选项
  if (emotions.includes('焦虑')) {
    options.push({ label: '想找到放松的方法', value: '想找到放松的方法' });
  }
  if (emotions.includes('难过')) {
    options.push({ label: '希望被倾听和理解', value: '希望被倾听和理解' });
  }
  if (emotions.includes('愤怒')) {
    options.push({ label: '想找到冷静下来的方式', value: '想找到冷静下来的方式' });
  }
  if (emotions.includes('迷茫')) {
    options.push({ label: '需要明确下一步该怎么做', value: '需要明确下一步该怎么做' });
  }
  if (emotions.includes('孤独')) {
    options.push({ label: '希望有人陪伴', value: '希望有人陪伴' });
  }
  if (emotions.includes('疲惫')) {
    options.push({ label: '想要休息一下', value: '想要休息一下' });
  }
  
  return options.slice(0, 4);
}

/**
 * 执行完整的前端分析
 */

export function analyzeText(text: string): AnalysisResult {
  const emotions = analyzeEmotions(text);
  const keyEvent = extractKeyEvents(text);
  const keywords = extractKeywords(text);
  const interactionOptions = generateInteractionOptions(emotions);
  
  // 生成摘要
  let summary = '正在感受你的情绪...';
  if (emotions.length > 0) {
    summary = `感受到你可能在经历${emotions.join('、')}的情绪`;
  }
  
  return {
    emotions,
    keyEvent,
    keywords,
    interactionOptions,
    summary,
  };
}
