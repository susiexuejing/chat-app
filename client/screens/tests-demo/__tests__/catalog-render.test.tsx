import React from 'react';
import renderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import TestsDemo from '../index';
import { quizzes } from '@/features/tests-demo/model';

// Actual screen/reducer with a fourth data-only fixture. Native presentation
// primitives are test doubles: this is component rendering, not browser pixels.
jest.mock('@/components/Screen', () => ({ Screen: ({ children }: any) => require('react').createElement('Screen', null, children) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native', () => {
  const React = require('react');
  const host = (name: string) => ({ children, ...props }: any) => React.createElement(name, props, children);
  return { View: host('View'), Text: host('Text'), Pressable: host('Pressable'), StyleSheet: { create: (styles: unknown) => styles } };
});

test('fourth data-only fixture renders and completes through the unchanged screen', () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  quizzes.push({ ...quizzes[0], id: 'fourth-render-fixture', title: '第四个渲染示例' });
  let tree!: ReactTestRenderer;
  try {
    act(() => { tree = renderer.create(<TestsDemo />); });
    const press = (predicate: (props: any) => boolean) => {
      const node = tree.root.findAll(n => n.type === ('Pressable' as any) && predicate(n.props))[0];
      expect(node).toBeDefined();
      act(() => node.props.onPress());
    };
    const text = () => JSON.stringify(tree.toJSON());
    const childText = (c: any): string => typeof c === 'string' ? c : Array.isArray(c) ? c.map(childText).join('') : c?.props ? childText(c.props.children) : '';
    const label = (name: string) => press(p => childText(p.children).includes(name));
    expect(tree!.root.findAll(n => n.type === ('View' as any) && n.props.testID?.startsWith('test-card-'))).toHaveLength(4);
    press(p => p.accessibilityLabel === '第四个渲染示例，开始测试');
    expect(text()).toContain('第四个渲染示例');
    label('开始测试');
    for (let i = 0; i < 6; i++) {
      press(p => p.testID === 'answer-0');
      const selected = tree.root.findAll(n => n.type === ('Pressable' as any) && n.props.testID === 'answer-0')[0];
      expect(selected.props['aria-pressed']).toBe(true);
      const progress = tree.root.findAll(n => n.type === ('View' as any) && n.props.accessibilityRole === 'progressbar')[0];
      expect(progress.props['aria-valuenow']).toBe(i + 1);
      press(p => p.testID === 'next-question');
    }
    expect(text()).toContain('测试已完成');
    expect(text()).not.toContain('simulate-login');
    expect(text()).not.toContain('你的最近一次结果');
    press(p => p.testID === 'view-completed-result');
    expect(text()).toContain('演示登录');
    label('取消，返回完成页');
    expect(text()).toContain('测试已完成');
    expect(text()).not.toContain('simulate-login');
    label('返回修改答案');
    expect(tree.root.findAll(n => n.type === ('Pressable' as any) && n.props.testID === 'answer-0')[0].props['aria-pressed']).toBe(true);
    press(p => p.testID === 'next-question');
    press(p => p.testID === 'view-completed-result');
    press(p => p.testID === 'simulate-login');
    expect(text()).toContain('你的最近一次结果');
    expect(text()).toContain('第四个渲染示例');
    expect(text()).toContain('先给自己一点空间');
    label('返回测试');
    expect(text()).not.toContain('本次结果');
    press(p => p.accessibilityLabel === '第四个渲染示例，查看结果');
    expect(text()).toContain('你的最近一次结果');
    label('重新测试');
    press(p => p.testID === 'answer-2');
    press(p => p.accessibilityLabel === '返回测试');
    press(p => p.accessibilityLabel === '第四个渲染示例，查看结果');
    expect(text()).toContain('先给自己一点空间');
  } finally {
    act(() => tree?.unmount());
    quizzes.pop();
  }
});


test('real screen card actions preserve all latest results and retest only selected test', () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  let tree!: ReactTestRenderer;
  try {
    act(() => { tree = renderer.create(<TestsDemo />); });
    const childText = (c: any): string => typeof c === 'string' ? c : Array.isArray(c) ? c.map(childText).join('') : c?.props ? childText(c.props.children) : '';
    const press = (predicate: (props: any) => boolean) => {
      const node = tree.root.findAll(n => n.type === ('Pressable' as any) && predicate(n.props))[0];
      expect(node).toBeDefined(); act(() => node.props.onPress());
    };
    const label = (name: string) => press(p => childText(p.children) === name);
    const id = (testID: string) => press(p => p.testID === testID);
    const text = () => JSON.stringify(tree.toJSON());
    const finish = (option: number) => { for (let i = 0; i < 6; i++) { id(`answer-${option}`); id('next-question'); } };
    id('open-stress'); label('开始测试'); finish(0); id('view-completed-result'); id('simulate-login'); label('返回测试');
    id('open-boundaries'); label('开始测试'); finish(1); label('返回测试');
    id('open-recovery'); label('开始测试'); finish(2); label('返回测试');
    expect(tree.root.findAll(n => n.type === ('Pressable' as any) && n.props.accessibilityLabel?.endsWith('，查看结果'))).toHaveLength(3);
    for (const [quiz, title] of [['stress','先给自己一点空间'],['boundaries','在沟通中寻找空间'],['recovery','从一件小事开始']]) {
      id(`open-${quiz}`); expect(text()).toContain(title); label('返回测试');
    }
    id('open-stress'); label('重新测试');
    press(p => p.accessibilityLabel === '返回测试');
    id('open-stress'); expect(text()).toContain('先给自己一点空间'); label('返回测试');
    id('resume-stress'); expect(text()).toContain('遇到压力时，你通常会怎么做？'); id('answer-1'); id('next-question'); id('answer-2');
    press(p => p.accessibilityLabel === '返回测试'); id('resume-stress');
    expect(text()).toContain('事情突然变多时，哪种方式更适合你？');
    expect(tree.root.findAll(n => n.type === ('Pressable' as any) && n.props.testID === 'answer-2')[0].props['aria-pressed']).toBe(true);
    press(p => p.accessibilityLabel === '返回测试'); id('open-stress'); expect(text()).toContain('先给自己一点空间');
    label('重新测试'); finish(1); expect(text()).toContain('让连接成为支持'); label('返回测试'); expect(text()).not.toContain('resume-stress');
    id('open-boundaries'); expect(text()).toContain('在沟通中寻找空间'); label('返回测试');
    id('open-stress'); label('重新测试'); id('answer-0'); label('演示身份 A'); label('演示身份 B'); id('simulate-login');
    expect(tree.root.findAll(n => n.type === ('Pressable' as any) && n.props.accessibilityLabel?.endsWith('，查看结果'))).toHaveLength(0);
    expect(text()).not.toContain('resume-stress'); id('open-stress'); label('开始测试'); finish(2); label('重新测试'); label('退出演示并清除本次内容');
    expect(tree.root.findAll(n => n.type === ('Pressable' as any) && n.props.accessibilityLabel?.endsWith('，开始测试'))).toHaveLength(3);
    expect(text()).not.toContain('演示身份 B');
  } finally { act(() => tree?.unmount()); }
});
