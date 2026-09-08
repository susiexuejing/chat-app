import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react-native';

import { RoleHeader } from '../components/RoleHeader';

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

async function renderHeader(hasHistory: boolean) {
  return await render(
    <RoleHeader
      hasHistory={hasHistory}
      onNewChat={jest.fn()}
      onShowHistory={jest.fn()}
      onShowRoleDetail={jest.fn()}
      onShowRolePicker={jest.fn()}
    />,
  );
}

describe('EF-177 chat actions', () => {
  afterEach(async () => {
    await cleanup();
  });

  it.each([false, true])('shows working history and new-chat entries with hasHistory=%s', async (hasHistory) => {
    const onShowHistory = jest.fn();
    const onNewChat = jest.fn();
    const view = await render(
      <RoleHeader
        hasHistory={hasHistory}
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

  it('keeps both actions visible without existing history', async () => {
    const view = await renderHeader(false);

    expect(view.getByText('历史聊天')).toBeTruthy();
    expect(view.getByText('新对话')).toBeTruthy();
  });
});
