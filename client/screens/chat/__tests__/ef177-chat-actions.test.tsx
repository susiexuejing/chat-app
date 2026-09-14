import React from 'react';
import '@testing-library/react-native/dont-cleanup-after-each';
import { cleanup, fireEvent, render } from '@testing-library/react-native';
import { RoleHeader } from '../components/RoleHeader';

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

describe('EF-177 chat header actions', () => {
  afterEach(async () => {
    await cleanup();
  });

  it('shows history and new-chat entries in the normal header', async () => {
    const view = await render(
      <RoleHeader
        hasHistory={false}
        onNewChat={jest.fn()}
        onShowHistory={jest.fn()}
        onShowRoleDetail={jest.fn()}
        onShowRolePicker={jest.fn()}
      />,
    );

    expect(view.getByText('历史聊天')).toBeTruthy();
    expect(view.getByText('新对话')).toBeTruthy();
  });

  it('invokes the existing callbacks for both entries', async () => {
    const onShowHistory = jest.fn();
    const onNewChat = jest.fn();
    const view = await render(
      <RoleHeader
        hasHistory={false}
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
