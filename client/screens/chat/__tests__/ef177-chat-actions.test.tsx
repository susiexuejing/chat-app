import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react-native';

import { RoleHeader } from '../components/RoleHeader';

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

describe('EF-177 chat navigation actions', () => {
  afterEach(async () => {
    await cleanup();
  });

  it.each([false, true])(
    'keeps history and new-conversation actions visible with hasHistory=%s',
    async (hasHistory) => {
      const view = await render(
        <RoleHeader
          hasHistory={hasHistory}
          onNewChat={jest.fn()}
          onShowHistory={jest.fn()}
          onShowRoleDetail={jest.fn()}
          onShowRolePicker={jest.fn()}
        />,
      );

      expect(view.getByText('历史聊天')).toBeTruthy();
      expect(view.getByText('新对话')).toBeTruthy();
    },
  );

  it('connects each action to its existing callback', async () => {
    const onShowHistory = jest.fn();
    const onNewChat = jest.fn();
    const view = await render(
      <RoleHeader
        hasHistory
        onNewChat={onNewChat}
        onShowHistory={onShowHistory}
        onShowRoleDetail={jest.fn()}
        onShowRolePicker={jest.fn()}
      />,
    );

    await fireEvent.press(view.getByText('历史聊天'));
    await fireEvent.press(view.getByText('新对话'));

    expect(onShowHistory).toHaveBeenCalledTimes(1);
    expect(onNewChat).toHaveBeenCalledTimes(1);
  });
});
