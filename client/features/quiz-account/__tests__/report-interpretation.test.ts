import { presentQuizDimension } from '../report-interpretation';

describe('四维报告解读', () => {
  it('shows each pair of scores plus a distinct directional interpretation', () => {
    const dimensions=[
      ['EI','精力与交流','在交流里整理思路','先独立整理再交流'],
      ['SN','信息与理解','从具体细节切入','先找联系和可能性'],
      ['TF','判断与取舍','先比较理由和标准','先考虑对人的影响'],
      ['JP','计划与节奏','先把安排定下来','给变化留出空间'],
    ];
    const copies=new Set<string>();
    for(const [i,[dimension,title,leftCopy,rightCopy]] of dimensions.entries()) {
      const total=i===0?24:23;
      const left=presentQuizDimension({dimension,preferred:dimension[0],scores:[15,total-15]});
      const right=presentQuizDimension({dimension,preferred:dimension[1],scores:[total-15,15]});
      expect(left?.title).toBe(title);
      expect(left?.score).toContain('15');
      expect(left?.score).toContain(String(total-15));
      expect(left?.score).not.toContain('无明显偏向');
      expect(left?.interpretation).toBe(leftCopy);
      expect(right?.interpretation).toBe(rightCopy);
      expect(left?.interpretation).not.toBe(right?.interpretation);
      if(left&&right){copies.add(left.interpretation);copies.add(right.interpretation);}
    }
    expect(copies.size).toBe(8);
  });
  it('a real 12:12 EI tie shows both sides and a neutral interpretation',()=>{
    const tie=presentQuizDimension({dimension:'EI',preferred:null,scores:[12,12]});
    expect(tie?.score).toBe('外向 12 · 内向 12 · 无明显偏向');
    expect(tie?.interpretation).toBe('无明显偏向，两种方式选得一样多');
    expect(tie?.interpretation).not.toContain('更偏向');
  });
  it('fails closed when handed an unsupported dimension or preferred side',()=>{
    expect(presentQuizDimension({dimension:'unexpected',preferred:null,scores:[12,12]})).toBeNull();
    expect(presentQuizDimension({dimension:'EI',preferred:'X',scores:[13,11]})).toBeNull();
  });
});
