import type { QuizReport } from './api';

type DimensionCopy = {
  title: string;
  labels: readonly [string, string];
  interpretations: readonly [string, string];
};

// Reuse the original EmotionFlow public93DimensionReport wording from the
// reviewed EF-395 static baseline, not the 16 reports from the question source.
const copyByDimension: Readonly<Record<string, DimensionCopy>> = {
  EI: { title: '精力与交流', labels: ['外向', '内向'], interpretations: ['在交流里整理思路', '先独立整理再交流'] },
  SN: { title: '信息与理解', labels: ['实感', '直觉'], interpretations: ['从具体细节切入', '先找联系和可能性'] },
  TF: { title: '判断与取舍', labels: ['思考', '情感'], interpretations: ['先比较理由和标准', '先考虑对人的影响'] },
  JP: { title: '计划与节奏', labels: ['判断', '感知'], interpretations: ['先把安排定下来', '给变化留出空间'] },
};
const tiedInterpretation = '无明显偏向，两种方式选得一样多';

export function presentQuizDimension(side: QuizReport['sides'][number]) {
  if (!Object.hasOwn(copyByDimension, side.dimension)) return null;
  const copy=copyByDimension[side.dimension];
  const choice=side.preferred===null?2:side.preferred===side.dimension[0]?0:side.preferred===side.dimension[1]?1:-1;
  if (choice===-1) return null;
  return {
    title:copy.title,
    score:`${copy.labels[0]} ${side.scores[0]} · ${copy.labels[1]} ${side.scores[1]}${choice===2?' · 无明显偏向':''}`,
    interpretation:choice===2?tiedInterpretation:copy.interpretations[choice],
  };
}
