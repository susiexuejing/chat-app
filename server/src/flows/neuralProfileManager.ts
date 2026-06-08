import * as fs from 'fs';
import * as path from 'path';

// ==============================
// 类型定义
// ==============================

export interface SubconsciousWeights {
  analyticalDepth: number;   // 0~1: 分析倾向
  emotionalSupport: number;  // 0~1: 情感支持倾向
  actionGuidance: number;    // 0~1: 行动引导倾向
  reflectiveSpace: number;   // 0~1: 反思空间倾向
  totalInteractions: number;
  dominantEmotions: string[];
  recentTopics: string[];
  lastUpdated: number;
}

export interface NeuralProfile {
  userId: string;
  roleId: string;

  // 神经系统记忆接口
  attentionBias: string;
  valueBias: string;
  influenceLog: string[];
  longTermChangeLog: string[];

  // 潜意识权重
  subconscious: SubconsciousWeights;

  createdAt: number;
  updatedAt: number;
}

const DEFAULT_WEIGHTS: SubconsciousWeights = {
  analyticalDepth: 0.4,
  emotionalSupport: 0.5,
  actionGuidance: 0.3,
  reflectiveSpace: 0.4,
  totalInteractions: 0,
  dominantEmotions: [],
  recentTopics: [],
  lastUpdated: 0,
};

const DATA_DIR = path.resolve(import.meta.dirname, '../../data');
const PROFILES_FILE = path.join(DATA_DIR, 'neural_profiles.json');

// ==============================
// 管理器
// ==============================

class NeuralProfileManager {
  private profiles: Map<string, NeuralProfile> = new Map();
  private loaded = false;

  private profileKey(userId: string, roleId: string): string {
    return `${userId}::${roleId}`;
  }

  private ensureDataDir(): void {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  loadProfiles(): void {
    try {
      this.ensureDataDir();
      if (fs.existsSync(PROFILES_FILE)) {
        const raw = fs.readFileSync(PROFILES_FILE, 'utf-8');
        const data = JSON.parse(raw) as Record<string, NeuralProfile>;
        this.profiles.clear();
        for (const [key, profile] of Object.entries(data)) {
          this.profiles.set(key, profile);
        }
      }
      this.loaded = true;
      console.log(`[Neural] 已加载 ${this.profiles.size} 个用户神经档案`);
    } catch (err) {
      console.error('[Neural] 加载档案失败:', err);
      this.loaded = true;
    }
  }

  private saveProfiles(): void {
    try {
      this.ensureDataDir();
      const data: Record<string, NeuralProfile> = {};
      for (const [key, profile] of this.profiles.entries()) {
        data[key] = profile;
      }
      fs.writeFileSync(PROFILES_FILE, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      console.error('[Neural] 保存档案失败:', err);
    }
  }

  getOrCreateProfile(userId: string, roleId: string): NeuralProfile {
    const key = this.profileKey(userId, roleId);
    let profile = this.profiles.get(key);
    if (!profile) {
      profile = {
        userId,
        roleId,
        attentionBias: 'default',
        valueBias: 'default',
        influenceLog: [],
        longTermChangeLog: [],
        subconscious: { ...DEFAULT_WEIGHTS, lastUpdated: Date.now() },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      this.profiles.set(key, profile);
      this.saveProfiles();
    }
    return profile;
  }

  updateAfterSession(userId: string, roleId: string, message: string, deepContent?: string): void {
    const profile = this.getOrCreateProfile(userId, roleId);
    const weights = profile.subconscious;

    // 更新交互次数
    weights.totalInteractions += 1;

    // 1. 分析深度：长消息 → 提高分析权重，短消息 → 降低
    const msgLen = message.length;
    const newAnalytical = Math.min(1, Math.max(0.1,
      msgLen < 10 ? 0.2 :
      msgLen < 30 ? 0.35 :
      msgLen < 80 ? 0.5 :
      msgLen < 150 ? 0.65 : 0.8
    ));
    weights.analyticalDepth = smoothUpdate(weights.analyticalDepth, newAnalytical, 0.3);

    // 2. 情感支持：检测情绪词
    const emotionWords = ['难受', '伤心', '难过', '焦虑', '害怕', '担心', '哭',
      '烦躁', '累', '疲惫', '孤独', '委屈', '愤怒', '生气', '失望', '迷茫',
      '无助', '痛苦', '压抑', '堵', '慌', '不安', '紧张', '压力'];
    const foundEmotions = emotionWords.filter(w => message.includes(w));
    if (foundEmotions.length > 0) {
      weights.emotionalSupport = smoothUpdate(weights.emotionalSupport, 0.8, 0.4);
      // 记录情绪
      for (const e of foundEmotions) {
        if (!weights.dominantEmotions.includes(e)) {
          weights.dominantEmotions.push(e);
        }
      }
      // 只保留最近 5 个
      if (weights.dominantEmotions.length > 5) {
        weights.dominantEmotions = weights.dominantEmotions.slice(-5);
      }
    } else {
      weights.emotionalSupport = smoothUpdate(weights.emotionalSupport, 0.35, 0.3);
    }

    // 3. 行动引导：检测行动词
    const actionWords = ['应该', '需要', '必须', '不知道怎么办', '怎么办', '想改变',
      '该不该', '要不要', '能不能', '怎么做'];
    const hasAction = actionWords.some(w => message.includes(w));
    weights.actionGuidance = hasAction
      ? smoothUpdate(weights.actionGuidance, 0.7, 0.4)
      : smoothUpdate(weights.actionGuidance, 0.25, 0.3);

    // 4. 反思空间：检测反思词
    const reflectWords = ['为什么', '是不是', '难道', '到底', '想不通',
      '不明白', '理解不了', '想不明白', '反复', '一直'];
    const hasReflect = reflectWords.some(w => message.includes(w));
    weights.reflectiveSpace = hasReflect
      ? smoothUpdate(weights.reflectiveSpace, 0.75, 0.4)
      : smoothUpdate(weights.reflectiveSpace, 0.35, 0.3);

    // 5. 记录话题
    const topicPatterns: [RegExp, string][] = [
      [/工作|领导|同事|辞职|加班|项目|客户/i, '工作'],
      [/关系|男朋友|女朋友|老公|老婆|分手|吵架|结婚|离婚/i, '亲密关系'],
      [/家庭|父母|孩子|家人|家里|爸妈|妈妈|爸爸|兄弟姐妹/i, '家庭'],
      [/焦虑|压力|考试|面试|害怕/i, '焦虑'],
      [/朋友|社交|聚会|同事.*关系|人际/i, '社交'],
      [/健康|生病|失眠|医院|吃药|身体|睡不好/i, '健康'],
      [/未来|方向|迷茫|找不到|做什么|人生/i, '人生方向'],
    ];
    for (const [pattern, topic] of topicPatterns) {
      if (pattern.test(message)) {
        if (!weights.recentTopics.includes(topic)) {
          weights.recentTopics.push(topic);
        }
        break;
      }
    }
    if (weights.recentTopics.length > 5) {
      weights.recentTopics = weights.recentTopics.slice(-5);
    }

    weights.lastUpdated = Date.now();
    profile.updatedAt = Date.now();

    this.saveProfiles();
  }

  /** 生成神经状态文本片段，用于注入提示词 */
  formatNeuralStateBlock(profile: NeuralProfile): string {
    const w = profile.subconscious;
    const emotionsStr = w.dominantEmotions.length > 0
      ? w.dominantEmotions.join('、')
      : '尚未记录';
    const topicsStr = w.recentTopics.length > 0
      ? w.recentTopics.join('、')
      : '尚未记录';

    return `
### 当前会话神经系统参数

#### 用户档案
- 与用户对话次数：${w.totalInteractions}
- 近期高频情绪：${emotionsStr}
- 近期高频话题：${topicsStr}

#### 潜意识权重（基于历史对话动态调整）
- 分析深度倾向：${(w.analyticalDepth * 100).toFixed(0)}%
- 情感支持倾向：${(w.emotionalSupport * 100).toFixed(0)}%
- 行动引导倾向：${(w.actionGuidance * 100).toFixed(0)}%
- 反思空间倾向：${(w.reflectiveSpace * 100).toFixed(0)}%

#### 神经系统记忆接口
- 当前注意力偏向：${profile.attentionBias}
- 当前价值观偏向：${profile.valueBias}
- 用户影响记录：[${profile.influenceLog.join('; ') || '空'}]
- 长期变化记录：[${profile.longTermChangeLog.join('; ') || '空'}]

回复时请参考以上神经系统参数调整语气和内容方向。
`;
  }
}

/** 平滑更新：newVal * rate + oldVal * (1-rate) */
function smoothUpdate(oldVal: number, newVal: number, rate: number): number {
  return +(newVal * rate + oldVal * (1 - rate)).toFixed(3);
}

// 单例
export const neuralManager = new NeuralProfileManager();