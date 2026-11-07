/** Avatar presentation; an explicit null avoids external images in isolated journeys. */
import React from 'react';
import { Image, Text, View } from 'react-native';

interface ChatAvatarViewProps {
  uri?: string | null;
  className: string;
}

export function ChatAvatarView({ uri, className }: ChatAvatarViewProps) {
  if (uri === null) {
    return (
      <View className={`${className} bg-emerald-100 items-center justify-center`}>
        <Text className="text-emerald-700 font-medium">伴</Text>
      </View>
    );
  }
  return <Image source={{ uri }} className={className} />;
}
