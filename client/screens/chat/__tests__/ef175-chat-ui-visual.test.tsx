import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
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

describe('EF-175 chat product identity', () => {
  it.each([false, true])('shows EmotionFlow for a chat header with hasHistory=%s', async (hasHistory) => {
    const view = await renderHeader(hasHistory);

    expect(view.getByText('EmotionFlow')).toBeTruthy();
    expect(view.queryByText('正在陪你')).toBeNull();
    expect(view.queryByText('聪明狐狸')).toBeNull();
  });

  it('preserves the existing companion-switch action', async () => {
    const onShowRolePicker = jest.fn();
    const view = await render(
      <RoleHeader
        hasHistory={false}
        onNewChat={jest.fn()}
        onShowHistory={jest.fn()}
        onShowRoleDetail={jest.fn()}
        onShowRolePicker={onShowRolePicker}
      />,
    );

    fireEvent.press(view.getByText('切换陪伴者'));
    expect(onShowRolePicker).toHaveBeenCalledTimes(1);
  });
});
