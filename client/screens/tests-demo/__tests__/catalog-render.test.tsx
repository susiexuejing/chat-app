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
  let tree: ReactTestRenderer;
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
    expect(tree!.root.findAll(n => n.type === ('Pressable' as any) && n.props.accessibilityLabel?.includes('6题'))).toHaveLength(4);
    press(p => p.accessibilityLabel === '第四个渲染示例，6题，约3分钟');
    expect(text()).toContain('第四个渲染示例');
    label('开始测试');
    for (let i = 0; i < 6; i++) {
      press(p => p.testID === 'answer-0');
      press(p => p.testID === 'next-question');
    }
    expect(text()).toContain('测试已完成');
    press(p => p.testID === 'simulate-login');
    expect(text()).toContain('测试结果');
    expect(text()).toContain('第四个渲染示例');
    expect(text()).toContain('先给自己一点空间');
  } finally {
    act(() => tree?.unmount());
    quizzes.pop();
  }
});
